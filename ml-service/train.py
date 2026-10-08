"""Train the forecast model on the paper logbook and print each stage.

Usage: python train.py [--logbook PATH]
With no flag, uses the only .xlsx file in data/.
"""

import argparse
from pathlib import Path

import pipeline

DATA_DIR = Path(__file__).parent / "data"


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


if __name__ == "__main__":
    main()
