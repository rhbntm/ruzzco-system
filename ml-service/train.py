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

    evaluation = pipeline.walk_forward(daily)
    print()
    print_comparison(evaluation, ticket["avg_ticket"])

    model = pipeline.train_final_model(daily)
    paths = write_artifacts(model, daily, ticket, evaluation, ARTIFACTS_DIR)
    print()
    for path in paths:
        print(f"Wrote {path.relative_to(Path(__file__).parent)}")


def write_artifacts(model, daily, ticket, evaluation, out_dir):
    """Save evaluation.json, model.joblib and metadata.json (section 7). Returns the three paths."""
    out_dir.mkdir(exist_ok=True)
    evaluation_path = out_dir / "evaluation.json"
    evaluation_path.write_text(json.dumps(evaluation_summary(evaluation), indent=2), encoding="utf-8")

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
        },
        "sklearn_version": sklearn.__version__,
    }
    metadata_path = out_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return [evaluation_path, model_path, metadata_path]


def week_label(week):
    start, end = week["start"], week["end"]
    return f"{start:%b} {start.day} – {end:%b} {end.day}"


def print_comparison(evaluation, avg_ticket):
    """The section 6 table: MAE in customers per day for each test week and the mean."""
    print(f"{'Test week':<24} {'Days':>4}  {'Average':>7}  {'Weekday':>7}  {'Last-7':>6}  Random Forest")
    for week in evaluation["weeks"]:
        mae = week["mae"]
        print(
            f"{week_label(week):<24} {week['days']:>4}  {mae['average']:>7.2f}  {mae['weekday']:>7.2f}  "
            f"{mae['last7']:>6.2f}  {mae['random_forest']:>8.2f}"
        )
    mean = evaluation["mean"]
    print(
        f"{'Mean':<24} {'':>4}  {mean['average']:>7.2f}  {mean['weekday']:>7.2f}  "
        f"{mean['last7']:>6.2f}  {mean['random_forest']:>8.2f}"
    )
    spread = evaluation["spread"]
    print(
        f"{'Spread (SD of weeks)':<24} {'':>4}  {spread['average']:>7.2f}  {spread['weekday']:>7.2f}  "
        f"{spread['last7']:>6.2f}  {spread['random_forest']:>8.2f}"
    )
    print(
        f"Random Forest beats the best simple average ({evaluation['best_baseline']}) "
        f"in {evaluation['weeks_rf_won']} of {evaluation['weeks_tested']} weeks."
    )
    rf = mean["random_forest"]
    print(f"Typical error: {rf:.2f} customers a day (about ₱{rf * avg_ticket:,.0f} at ₱{avg_ticket:,.2f} per customer).")


def evaluation_summary(evaluation):
    """What goes in evaluation.json: per-week numbers, means, best baseline, weeks won and tested."""
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
