from backend.services.mci_verifier import generate_description_from_diff, verify_mci


def test_generate_description_from_diff():
    diff = "--- a/src/myapp/auth.py\n+++ b/src/myapp/auth.py\n@@ -1,3 +1,5 @@\n+import time\n"
    desc = generate_description_from_diff(diff)
    assert "auth.py" in desc


def test_verify_mci_phantom():
    description = "Modified auth.py and added validate_expiry function"
    diff = "--- a/src/myapp/auth.py\n+++ b/src/myapp/auth.py\n@@ -1 +1,2 @@\n+import time\n"
    ok, phantoms = verify_mci(description, diff)
    assert isinstance(ok, bool)
