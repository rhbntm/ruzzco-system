"""Train the forecast model on the paper logbook and print each stage.

Usage: python train.py [--logbook PATH]
With no flag, uses the only .xlsx file in data/.
"""

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path

import joblib
import sklearn

import pipeline

DATA_DIR = Path(__file__).parent / "data"
ARTIFACTS_DIR = Path(__file__).parent / "artifacts"
# Asia/Manila is UTC+8 all year (no daylight saving), so a fixed offset is exact.
MANILA = dt.timezone(dt.timedelta(hours=8), "Asia/Manila")


def find_logbook(data_dir=DATA_DIR):
    """The only .xlsx file in data/; fails if there are none or several."""
    found = sorted(data_dir.glob("*.xlsx"))
    if len(found) != 1:
        raise SystemExit(f"Expected exactly one .xlsx file in {data_dir}, found {len(found)}. Use --logbook PATH.")
    return found[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--logbook", type=Path, help="workbook to read instead of the one in data/")
    parser.add_argument("--evaluate-only", action="store_true", help="print the tables and write evaluation.json; leave the served model and metadata alone")
    args = parser.parse_args()
    logbook = args.logbook or find_logbook()

    entries, day_check = pipeline.load_workbook(logbook)
    daily = pipeline.build_daily_table(entries, day_check)
    data_from, data_to = daily["date"].min(), daily["date"].max()
    ticket = pipeline.average_ticket(entries, data_from, data_to)

    counts = daily["status"].value_counts()
    print(f"Logbook: {logbook.name}")
    print(f"Range: {data_from.date()} to {data_to.date()}")
    print(
        f"{len(daily)} calendar days, {counts.get('open', 0)} open, {counts.get('closed', 0)} closed, "
        f"{counts.get('unknown', 0)} unknown, {int(daily['customers'].sum())} Entries rows, "
        f"average ticket ₱{ticket['avg_ticket']:,.2f} "
        f"(₱{ticket['amount_total']:,.0f} / {ticket['rows_with_amount']} rows with an amount)"
    )

    reference = pipeline.walk_forward(daily)
    test = pipeline.walk_forward(daily, test_from=pipeline.TEST_FROM)
    evaluation, basis = choose_evaluation(reference, test)
    print()
    print_comparison(reference, "Reference, not the test (last 4 weeks, whatever their dates)")
    print()
    print_comparison(test, f"Test: weeks starting {pipeline.TEST_FROM.date()} or later")
    print()
    print_verdicts(evaluation, basis)
    print(f"Typical error: {evaluation['mean']['random_forest']:.2f} customers a day "
          f"(about ₱{evaluation['mean']['random_forest'] * ticket['avg_ticket']:,.0f} "
          f"at ₱{ticket['avg_ticket']:,.2f} per customer, {basis} weeks).")

    if args.evaluate_only:
        ARTIFACTS_DIR.mkdir(exist_ok=True)
        path = ARTIFACTS_DIR / "evaluation.json"
        path.write_text(json.dumps(evaluation_summary(evaluation, reference, test, basis), indent=2), encoding="utf-8")
        print()
        print(f"Wrote {path.relative_to(Path(__file__).parent)} (model and metadata untouched)")
        return

    model = pipeline.train_final_model(daily)
    paths = write_artifacts(model, daily, ticket, evaluation, ARTIFACTS_DIR, reference, test, basis)
    print()
    for path in paths:
        print(f"Wrote {path.relative_to(Path(__file__).parent)}")


def choose_evaluation(reference, test):
    """The evaluation that feeds the dashboard fields: the test weeks, else the reference (slice 8 Decision 7)."""
    if test["weeks_tested"] > 0:
        return test, "test"
    return reference, "reference"


def write_artifacts(model, daily, ticket, evaluation, out_dir, reference=None, test=None, basis="reference"):
    """Save evaluation.json, model.joblib and metadata.json (section 7). Returns the three paths.

    `evaluation` feeds the top-level fields; `basis` says whether it is the test weeks or the
    reference weeks (slice 8 Decision 7). reference and test, when given, are written in full.
    """
    out_dir.mkdir(exist_ok=True)
    evaluation_path = out_dir / "evaluation.json"
    evaluation_path.write_text(json.dumps(evaluation_summary(evaluation, reference, test, basis), indent=2), encoding="utf-8")

    model_path = out_dir / "model.joblib"
    joblib.dump(model, model_path)
    model_hash = hashlib.sha256(model_path.read_bytes()).hexdigest()[:8]

    data_from, data_to = daily["date"].min().date(), daily["date"].max().date()
    best = evaluation["best_baseline"]
    metadata = {
        "model_version": f"rf-{data_to.isoformat()}-{model_hash}",
        "trained_at": dt.datetime.now(MANILA).isoformat(timespec="seconds"),
        "data_from": data_from.isoformat(),
        "data_to": data_to.isoformat(),
        "training_days": int(daily["use_for_training"].sum()),
        "features": pipeline.FEATURES,
        "payday_rule": pipeline.PAYDAY_RULE,
        "avg_ticket": ticket["avg_ticket"],
        "rows_with_amount": ticket["rows_with_amount"],
        "evaluation": {
            "weeks_tested": evaluation["weeks_tested"],
            "rf_mae": round(evaluation["mean"]["random_forest"], 2),
            "best_baseline": best,
            "best_baseline_mae": round(evaluation["mean"][best], 2),
            "weeks_rf_won": evaluation["weeks_rf_won"],
            "basis": basis,
            "test_from": pipeline.TEST_FROM.date().isoformat(),
        },
        "sklearn_version": sklearn.__version__,
    }
    metadata_path = out_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return [evaluation_path, model_path, metadata_path]


def week_label(week):
    start, end = week["start"], week["end"]
    return f"{start:%b} {start.day} – {end:%b} {end.day}"


COLUMNS = [
    ("average", "Average"), ("weekday", "Weekday"), ("last7", "Last-7"), ("naive", "Naive"),
    ("linear", "Linear*"), ("gboost", "GBoost*"), ("random_forest", "RF"), ("random_forest_last7", "RF+last7"),
]


def print_comparison(evaluation, title):
    """MAE in customers per day for each week, the mean and the spread. * = evidence for Chapter 3, not a simple method."""
    print(title)
    if not evaluation["weeks"]:
        print(f"No full test week after {pipeline.TEST_FROM.date() - dt.timedelta(days=1)} yet.")
        return
    print(f"{'Week':<18} {'Days':>4}  " + "  ".join(f"{label:>8}" for _, label in COLUMNS))

    def row(label, days, values):
        print(f"{label:<18} {days:>4}  " + "  ".join(f"{values[m]:>8.2f}" for m, _ in COLUMNS))

    for week in evaluation["weeks"]:
        row(week_label(week), week["days"], week["mae"])
    row("Mean", "", evaluation["mean"])
    row("Spread (SD weeks)", "", evaluation["spread"])


def print_verdicts(evaluation, basis):
    """Whether each Random Forest beat the best simple method, week by week (slice 8 Decision 7)."""
    best = evaluation["best_baseline"]
    for method, name in (("random_forest_last7", "Random Forest + last-7"), ("random_forest", "Random Forest")):
        won = sum(w["mae"][method] < w["mae"][best] for w in evaluation["weeks"])
        print(f"{name} beats the best simple method ({best}) in {won} of {evaluation['weeks_tested']} {basis} weeks.")


def evaluation_summary(evaluation, reference=None, test=None, basis="reference"):
    """What goes in evaluation.json: the dashboard fields, plus the reference and test sections in full."""
    return {
        **weeks_summary(evaluation),
        "basis": basis,
        "reference": weeks_summary(reference) if reference else None,
        "test": weeks_summary(test) if test else None,
    }


def weeks_summary(evaluation):
    """Per-week numbers, means, best simple method, weeks won and tested."""
    return {
        "weeks": [
            {
                "start": week["start"].date().isoformat(),
                "end": week["end"].date().isoformat(),
                "days": week["days"],
                "mae": {m: round(v, 4) for m, v in week["mae"].items()},
            }
            for week in evaluation["weeks"]
        ],
        "mean": {m: round(v, 4) for m, v in evaluation["mean"].items()},
        "spread": {m: round(v, 4) for m, v in evaluation["spread"].items()},
        "best_baseline": evaluation["best_baseline"],
        "weeks_rf_won": evaluation["weeks_rf_won"],
        "weeks_tested": evaluation["weeks_tested"],
    }


if __name__ == "__main__":
    main()
