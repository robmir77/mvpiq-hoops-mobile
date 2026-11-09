import subprocess
from pathlib import Path

remote_path = "files/benchmark-images/Tiro a centrocampo/frame_000085.jpg"

result = subprocess.run(
    [
        "adb", "exec-out", "run-as",
        "com.mvpiqhoopsmobile",
        "sh", "-c", f"cat '{remote_path}'"
    ],
    capture_output=True
)

print("Exit code:", result.returncode)
print("Bytes ricevuti:", len(result.stdout))
print("Errore:", result.stderr.decode(errors="replace"))

if result.returncode == 0 and result.stdout:
    Path("frame_000085_android.jpg").write_bytes(result.stdout)
    print("File salvato correttamente.")
