"""Step 2 tests: workbook loading, daily table, calendar features, average ticket. Synthetic data only."""

import pandas as pd
import pytest

import pipeline

D = pd.Timestamp


def make_entries(rows):
    """rows: list of (date, amount); amount None means blank."""
    return pd.DataFrame({
        "date": [D(d) for d, _ in rows],
        "service": ["Haircut"] * len(rows),
        "amount": [float("nan") if a is None else a for _, a in rows],
    })


def make_day_check(statuses):
    """statuses: dict of date -> Day_Check status."""
    return pd.DataFrame({"date": [D(d) for d in statuses], "status": list(statuses.values())})


def three_day_logbook():
    entries = make_entries([("2026-07-13", 200), ("2026-07-13", 150), ("2026-07-16", 200)])
    day_check = make_day_check({
        "2026-07-13": "Has entries",
        "2026-07-14": "Closed (written)",
        "2026-07-15": "No page found",
        "2026-07-16": "Has entries",
    })
    return entries, day_check


def test_daily_table_open_closed_unknown():
    table = pipeline.build_daily_table(*three_day_logbook()).set_index("date")
    assert list(table.index) == list(pd.date_range("2026-07-13", "2026-07-16"))
    assert table.loc[D("2026-07-13"), "customers"] == 2
    assert table.loc[D("2026-07-14"), "customers"] == 0
    assert pd.isna(table.loc[D("2026-07-15"), "customers"])
    assert table["use_for_training"].tolist() == [True, False, False, True]
    assert table["status"].tolist() == ["open", "closed", "unknown", "open"]


def test_daily_table_ignores_pre_gap_and_ends_at_last_open_day():
    entries, day_check = three_day_logbook()
    day_check = pd.concat([
        make_day_check({"2026-07-01": "Has entries", "2026-07-17": "Not yet encoded"}),
        day_check,
    ])
    table = pipeline.build_daily_table(entries, day_check)
    assert table["date"].min() == pipeline.POST_GAP_START
    assert table["date"].max() == D("2026-07-16")


def check_fails(entries, day_check, bad_date):
    with pytest.raises(ValueError, match=bad_date):
        pipeline.build_daily_table(entries, day_check)


def test_fails_has_entries_without_rows():
    entries, day_check = three_day_logbook()
    day_check.loc[day_check["date"] == D("2026-07-14"), "status"] = "Has entries"
    check_fails(entries, day_check, "Has entries' but no Entries rows: 2026-07-14")


def test_fails_closed_with_rows():
    entries, day_check = three_day_logbook()
    entries = pd.concat([entries, make_entries([("2026-07-14", 200)])])
    check_fails(entries, day_check, "Closed \\(written\\)' but has Entries rows: 2026-07-14")


def test_fails_no_page_with_rows():
    entries, day_check = three_day_logbook()
    entries = pd.concat([entries, make_entries([("2026-07-15", 200)])])
    check_fails(entries, day_check, "No page found' but has Entries rows: 2026-07-15")


def test_fails_entries_date_missing_from_day_check():
    entries, day_check = three_day_logbook()
    day_check = day_check[day_check["date"] != D("2026-07-13")]
    check_fails(entries, day_check, "Entries date missing from Day_Check: 2026-07-13")


def test_fails_not_yet_encoded_inside_range():
    entries, day_check = three_day_logbook()
    day_check.loc[day_check["date"] == D("2026-07-15"), "status"] = "Not yet encoded"
    check_fails(entries, day_check, "Not yet encoded' on or before 2026-07-16: 2026-07-15")


def test_load_workbook_drops_dateless_day_check_rows(tmp_path):
    path = tmp_path / "logbook.xlsx"
    with pd.ExcelWriter(path) as writer:
        pd.DataFrame({
            "Date": [D("2026-07-13"), D("2026-07-13")],
            "Service": ["Haircut", "Shave"],
            "Amount (PHP)": [200, None],
        }).to_excel(writer, sheet_name="Entries", index=False)
        pd.DataFrame({
            "Date": [D("2026-07-13"), "Note: page torn", None],
            "Status": ["Has entries", None, None],
        }).to_excel(writer, sheet_name="Day_Check", index=False)
    entries, day_check = pipeline.load_workbook(path)
    assert len(entries) == 2
    assert entries["amount"].isna().sum() == 1
    assert day_check["date"].tolist() == [D("2026-07-13")]


@pytest.mark.parametrize("date, dow", [("2026-10-12", 0), ("2026-10-18", 6)])
def test_dow(date, dow):
    assert pipeline.calendar_features([D(date)])["dow"].iloc[0] == dow


@pytest.mark.parametrize("date, expected", [
    ("2026-10-15", 0),
    ("2026-10-14", 14),
    ("2026-10-31", 1),
    ("2027-02-28", 0),
    ("2027-03-01", 1),
])
def test_days_since_payday(date, expected):
    assert pipeline.calendar_features([D(date)])["days_since_payday"].iloc[0] == expected


def test_weekend_and_columns():
    features = pipeline.calendar_features(pd.date_range("2026-10-16", "2026-10-19"))  # Fri..Mon
    assert list(features.columns) == pipeline.FEATURES
    assert features["is_weekend"].tolist() == [0, 1, 1, 0]


def test_average_ticket_excludes_blank_amounts():
    entries = make_entries([("2026-07-13", 200), ("2026-07-13", None), ("2026-07-14", 150)])
    result = pipeline.average_ticket(entries, D("2026-07-13"), D("2026-07-14"))
    assert result == {"avg_ticket": 175.0, "rows_with_amount": 2, "amount_total": 350.0}
