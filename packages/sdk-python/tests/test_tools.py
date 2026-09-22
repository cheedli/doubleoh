"""The plain-function tools against the same stub server as the client tests.

These functions are what every framework adapter serves, so what is asserted here is the
contract all of them inherit: model-readable strings, refusals as answers, and the
deflection path telling the agent to retry rather than wait.
"""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from doubleoh import DoubleOh  # noqa: E402
from doubleoh.tools import build_tools  # noqa: E402


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if "empty" in self.path:
            self._reply(200, {"skills": []})
        else:
            self._reply(200, {"skills": [{
                "name": "checkout-finish-2afd60",
                "description": "Use when finishing checkout.",
                "instructions": "1. Click checkout.",
                "timesWorked": 5, "timesFailed": 0,
            }]})

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path.endswith("/outcome"):
            self._reply(200, {"recorded": True, "retired": False})
        elif body.get("task") == "a known wall":
            self._reply(200, {"intervention": {
                "id": None, "fixUrl": None, "prepared": False, "deflected": True,
                "skill": {"name": "s", "description": "d",
                          "instructions": "1. Dismiss the wall.",
                          "timesWorked": 2, "timesFailed": 0}}})
        elif body.get("url", "").startswith("http://localhost"):
            self._reply(400, {"error": "That address is not reachable for a fix."})
        else:
            self._reply(201, {"intervention": {
                "id": "i-9", "fixUrl": "https://fix.example/fix/tok", "prepared": True}})


class ToolsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        client = DoubleOh(api_key="oo_test_1", base_url=f"http://127.0.0.1:{cls.server.server_port}")
        cls.skills_for, cls.request_fix, cls.report_skill = build_tools(client)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_functions_carry_the_names_and_docs_frameworks_read(self):
        # Plain-function frameworks (OpenAI Agents, AutoGen, Pydantic AI) build the tool
        # from exactly these attributes; if they drift, every adapter drifts.
        self.assertEqual(type(self).skills_for.__name__, "doubleoh_skills_for")
        self.assertIn("BEFORE attempting", type(self).skills_for.__doc__)
        self.assertIn("STUCK", type(self).request_fix.__doc__)
        self.assertIn("AFTER following a skill", type(self).report_skill.__doc__)

    def test_skills_render_as_context_to_follow(self):
        text = type(self).skills_for("finish checkout")
        self.assertIn("A colleague has done this before", text)
        self.assertIn("worked 5×", text)

    def test_no_skills_points_at_request_fix(self):
        text = type(self).skills_for("empty task nothing knows")
        self.assertIn("Nothing has been learned", text)
        self.assertIn("doubleoh_request_fix", text)

    def test_deflection_says_retry_not_wait(self):
        text = type(self).request_fix("https://shop.example", "a known wall")
        self.assertIn("No human was needed", text)
        self.assertIn("1. Dismiss the wall.", text)

    def test_a_fresh_fix_returns_the_link_and_says_move_on(self):
        text = type(self).request_fix("https://shop.example", "a brand new wall")
        self.assertIn("https://fix.example/fix/tok", text)
        self.assertIn("Move on", text)

    def test_a_refusal_is_an_answer_not_an_exception(self):
        text = type(self).request_fix("http://localhost:3001/admin", "reach inside")
        self.assertIn("DoubleOh refused (400)", text)
        self.assertIn("not reachable", text)

    def test_adapters_fail_with_an_installable_sentence(self):
        # None of the frameworks are installed in this environment, which IS the test.
        from doubleoh.langchain import doubleoh_tools as lc
        from doubleoh.crewai import doubleoh_tools as cr
        from doubleoh.llamaindex import doubleoh_tools as li
        client = DoubleOh(api_key="oo_test_1", base_url="http://127.0.0.1:1")
        for adapter, package in ((lc, "langchain-core"), (cr, "crewai"), (li, "llama-index-core")):
            with self.assertRaises(ImportError) as caught:
                adapter(client)
            self.assertIn(f"pip install {package}", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
