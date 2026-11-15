"""Controlli di sicurezza sui workflow GitHub. Si lanciano dalla radice:  python3 -m unittest discover -s tests -v"""
import glob
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
WORKFLOWS = sorted(glob.glob(os.path.join(ROOT, ".github", "workflows", "*.yml")))


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class WorkflowSecurity(unittest.TestCase):
    def test_there_are_workflows(self):
        self.assertTrue(WORKFLOWS)

    def test_every_external_action_is_pinned_to_a_commit(self):
        """Un'etichetta come @v5 può essere spostata da chi controlla l'azione: un commit no."""
        for path in WORKFLOWS:
            for n, line in enumerate(read(path).splitlines(), 1):
                m = re.match(r"\s*-?\s*uses:\s*(\S+)", line)
                if not m or m.group(1).startswith("./"):
                    continue
                self.assertRegex(m.group(1), r"@[0-9a-f]{40}$", f"{os.path.basename(path)}:{n}: azione non fissata a un commit ({m.group(1)})")

    def test_no_expression_is_interpolated_inside_a_shell_script(self):
        """`${{ ... }}` dentro `run:` viene sostituito prima dell'esecuzione: se il valore è controllabile da altri, è iniezione di comandi.
        I valori vanno passati con `env:` e letti come variabili della shell."""
        for path in WORKFLOWS:
            in_run, indent = False, 0
            for n, line in enumerate(read(path).splitlines(), 1):
                stripped = line.strip()
                cur = len(line) - len(line.lstrip())
                if in_run and stripped and cur <= indent:
                    in_run = False
                if re.match(r"-?\s*run:\s*[|>]", stripped):
                    in_run, indent = True, cur
                    continue
                if re.match(r"-?\s*run:\s*\S", stripped):
                    self.assertNotIn("${{", stripped, f"{os.path.basename(path)}:{n}: espressione dentro run:")
                    continue
                if in_run:
                    self.assertNotIn("${{", line, f"{os.path.basename(path)}:{n}: espressione dentro run: usa env:")

    def test_the_test_workflow_cannot_write(self):
        text = read(os.path.join(ROOT, ".github", "workflows", "tests.yml"))
        self.assertRegex(text, r"permissions:\s*\n\s+contents: read")
        self.assertIn("persist-credentials: false", text)

    def test_dependabot_keeps_actions_up_to_date(self):
        text = read(os.path.join(ROOT, ".github", "dependabot.yml"))
        self.assertIn("github-actions", text)


if __name__ == "__main__":
    unittest.main()
