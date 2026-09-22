"""The Python SDK against a real HTTP server — stdlib only, run with `python3 -m unittest`.

A stub server rather than mocked urllib, because what the SDK owns is the wire: paths,
headers, encoding, and how a refusal becomes an exception. A mock of urllib would pass
while the wire was wrong.
"""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from doubleoh import Intervention, DoubleOh, DoubleOhError  # noqa: E402

RECORDED: list[dict] = []


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def _reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        RECORDED.append({"method": "GET", "path": self.path, "key": self.headers.get("x-api-key")})
        if self.path.startswith("/v1/skills"):
            self._reply(200, {"skills": [{
                "name": "checkout-finish-2afd60",
                "description": "Use when finishing checkout.",
                "instructions": "1. Click checkout.",
                "timesWorked": 5,
                "timesFailed": 0,
            }]})
        elif self.path.startswith("/v1/interventions/"):
            # The first wait answers open, the second resolved: the long-poll's two shapes.
            waits = sum(1 for r in RECORDED if r["path"].startswith("/v1/interventions/"))
            self._reply(200, {"intervention": {
                "id": "i-9", "url": "https://shop.example", "task": "t",
                "status": "open" if waits < 2 else "resolved",
                "skillName": None if waits < 2 else "checkout-finish-2afd60",
                "blockedRuns": 1, "createdAt": "2026-09-16T00:00:00Z",
                "next": "Still open." if waits < 2 else "Resolved.",
            }})
        elif self.path == "/v1/interventions":
            self._reply(200, {"interventions": [{
                "id": "i-1", "url": "https://shop.example", "task": "t",
                "status": "resolved", "skillName": "checkout-finish-2afd60",
                "blockedRuns": 3, "createdAt": "2026-08-28T00:00:00Z",
            }]})
        else:
            self._reply(404, {"error": "Not found."})

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        RECORDED.append({"method": "POST", "path": self.path, "body": body,
                         "key": self.headers.get("x-api-key")})
        if self.path == "/v1/interventions":
            if body.get("task") == "a known wall":
                self._reply(200, {"intervention": {
                    "id": None, "fixUrl": None, "prepared": False, "deflected": True,
                    "skill": {"name": "s", "description": "d", "instructions": "1. x",
                              "timesWorked": 2, "timesFailed": 0},
                }})
            elif body.get("url", "").startswith("http://localhost"):
                self._reply(400, {
                    "error": "That address is not reachable for a fix.",
                    "code": "target_refused",
                    "next": "Use a public http(s) page.",
                })
            else:
                self._reply(200, {"intervention": {
                    "id": "i-9", "fixUrl": "https://fix.example/fix/tok",
                    "prepared": True,
                }})
        elif self.path.endswith("/outcome"):
            self._reply(200, {"recorded": True, "retired": False})
        else:
            self._reply(404, {"error": "No skill of yours by that name."})


class SdkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.client = DoubleOh(api_key="oo_test_1", base_url=f"http://127.0.0.1:{cls.server.server_port}")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_rejects_a_key_that_is_not_a_doubleoh_key(self):
        with self.assertRaises(ValueError):
            DoubleOh(api_key="sk-something-else")

    def test_skills_for_returns_typed_skills_with_confidence(self):
        skills = self.client.skills_for("finish checkout")
        self.assertEqual(skills[0].name, "checkout-finish-2afd60")
        self.assertEqual(skills[0].times_worked, 5)
        # The key travels as a header, and the task travels URL-encoded.
        sent = RECORDED[-1]
        self.assertEqual(sent["key"], "oo_test_1")
        self.assertIn("finish%20checkout", sent["path"])


    def test_wait_for_fix_holds_on_the_server_and_returns_when_resolved(self):
        done = self.client.wait_for_fix("i-9", timeout=30)
        self.assertEqual(done.status, "resolved")
        self.assertEqual(done.skill_name, "checkout-finish-2afd60")
        waits = [r["path"] for r in RECORDED if r["path"].startswith("/v1/interventions/i-9")]
        self.assertEqual(waits, ["/v1/interventions/i-9?wait=55", "/v1/interventions/i-9?wait=55"])

    def test_skills_for_scopes_to_the_page_host_when_given_a_url(self):
        self.client.skills_for("finish checkout", url="https://www.shop.example/cart?x=1&y=2")
        sent = RECORDED[-1]
        self.assertIn("task=finish%20checkout", sent["path"])
        # The url travels fully encoded, so its own query string cannot leak into ours.
        self.assertIn("&url=https%3A%2F%2Fwww.shop.example%2Fcart%3Fx%3D1%26y%3D2", sent["path"])
    def test_request_fix_returns_the_link(self):
        fix = self.client.request_fix("https://shop.example/checkout", "finish checkout")
        self.assertIsInstance(fix, Intervention)
        self.assertEqual(fix.fix_url, "https://fix.example/fix/tok")
        self.assertFalse(fix.deflected)

    def test_a_deflection_carries_the_skill_instead_of_a_link(self):
        fix = self.client.request_fix("https://shop.example/checkout", "a known wall")
        self.assertTrue(fix.deflected)
        self.assertIsNone(fix.fix_url)
        self.assertEqual(fix.skill.instructions, "1. x")

    def test_a_refusal_raises_the_servers_own_sentence(self):
        with self.assertRaises(DoubleOhError) as caught:
            self.client.request_fix("http://localhost:3001/admin", "reach the inside")
        self.assertEqual(caught.exception.status, 400)
        self.assertIn("not reachable", str(caught.exception))
        # The program reading this gets a stable code and the next move, not only the sentence.
        self.assertEqual(caught.exception.code, "target_refused")
        self.assertIn("public http(s)", caught.exception.next)

    def test_report_skill_sends_one_boolean(self):
        self.client.report_skill("checkout-finish-2afd60", True)
        self.assertEqual(RECORDED[-1]["body"], {"worked": True})
        self.assertIn("/v1/skills/checkout-finish-2afd60/outcome", RECORDED[-1]["path"])

    def test_interventions_carry_the_triage_number(self):
        rows = self.client.interventions()
        self.assertEqual(rows[0].blocked_runs, 3)
        self.assertEqual(rows[0].skill_name, "checkout-finish-2afd60")


if __name__ == "__main__":
    unittest.main()
