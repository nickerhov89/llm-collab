import unittest
from portal_access import report_query


class PortalBoundaryTests(unittest.TestCase):
    def test_sql_injection_and_caller_sql_refused(self):
        for args in [{"project_id": "x';DROP TABLE projects;--"}, {"query": "SELECT * FROM users"}]:
            with self.assertRaises(ValueError):
                report_query("portal.project", args)
        with self.assertRaises(ValueError):
            report_query("portal.projects", {"query": "SELECT 1"})

    def test_range_is_bounded_and_does_not_accept_bool_or_sql(self):
        for limit in [True, 0, 101, "1; SELECT 2"]:
            with self.assertRaises(ValueError):
                report_query("portal.projects", {"limit": limit})
        with self.assertRaises(ValueError):
            report_query("portal.projects", {"offset": -1})

    def test_report_is_read_only_and_has_no_financial_or_auth_fields(self):
        sql = report_query("portal.project", {"project_id": "00000000-0000-0000-0000-000000000001"})
        for forbidden in ["budget", "margin", "payment", "password", "UPDATE", "DELETE"]:
            self.assertNotIn(forbidden, sql)
        self.assertIn("LIMIT 20", sql)
        self.assertIn("LIMIT 30", sql)

    def test_unknown_operation_and_status_arguments_fail_closed(self):
        for tool, args in [("portal.write", {}), ("portal.status", {"host": "attacker"})]:
            with self.assertRaises(ValueError):
                report_query(tool, args)


if __name__ == "__main__":
    unittest.main()
