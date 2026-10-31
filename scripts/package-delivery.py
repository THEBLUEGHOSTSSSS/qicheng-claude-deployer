"""Package only the inspected application, instructions and a content manifest."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
APP = DIST / "win-unpacked"
OUTPUT = DIST / f"Qicheng-Deployer-{VERSION}-Windows-x64-Portable.zip"

if not (APP / "Qicheng Deployer.exe").is_file():
    raise SystemExit("Build Windows distribution first.")
if not (APP / "resources/app.asar").is_file():
    raise SystemExit("Missing application archive.")

files = {p.relative_to(APP).as_posix(): p for p in APP.rglob("*") if p.is_file()}
for name in files:
    if name.startswith((".work/", "tests/", "node_modules/")):
        raise SystemExit(f"Unexpected development artifact: {name}")
files["使用说明.md"] = ROOT / "docs/getting-started.md"
files["集成与安全.md"] = ROOT / "docs/integration.md"
files["验证范围.md"] = ROOT / "docs/validation.md"
files["LICENSE-Qicheng.txt"] = ROOT / "LICENSE"
instructions = f"""启程 · Claude 部署器 {VERSION}（Windows x64 Alpha）

1. 完整解压本文件夹，不要在 ZIP 里直接运行。
2. 双击 Qicheng Deployer.exe。不要只复制这一个 exe。
3. 按环境检查 → 安装组件 → 连接模型 → 验证与交付操作。
4. 安装外部软件需要联网；本程序自带运行时，不需要 Node.js 或 Python。
5. 本包尚未完成 Windows 真机与用户账户验证，详见“验证范围.md”。

软件本身没有单独的发布者代码签名。系统阻止时请让维护者核对来源，
不要关闭安全软件或系统保护。不要在聊天或截图里泄露 API Key。

操作说明：使用说明.md
文件完整性清单：SHA256SUMS.txt
诊断报告：在程序“验证与交付”页面点击导出。
""".replace("\n", "\r\n").encode("utf-8-sig")

manifest = []
with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name, source in sorted(files.items()):
        if source.is_symlink():
            raise SystemExit(f"Refusing symlink: {name}")
        data = source.read_bytes()
        archive.writestr(name, data)
        manifest.append(f"{hashlib.sha256(data).hexdigest()}  {name}")
    archive.writestr("先看这里.txt", instructions)
    manifest.append(f"{hashlib.sha256(instructions).hexdigest()}  先看这里.txt")
    archive.writestr("SHA256SUMS.txt", "\n".join(manifest) + "\n")

with zipfile.ZipFile(OUTPUT) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f"Corrupt zip member: {bad}")
    for line in archive.read("SHA256SUMS.txt").decode().splitlines():
        expected, name = line.split("  ", 1)
        actual = hashlib.sha256(archive.read(name)).hexdigest()
        if actual != expected:
            raise SystemExit(f"Digest mismatch: {name}")
    executable = archive.read("Qicheng Deployer.exe")
    if executable[:2] != b"MZ":
        raise SystemExit("Not a Windows executable")
    offset = int.from_bytes(executable[0x3C:0x40], "little")
    if executable[offset:offset + 4] != b"PE\0\0" or int.from_bytes(executable[offset + 4:offset + 6], "little") != 0x8664:
        raise SystemExit("Not a Windows x64 PE executable")

checksum = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
OUTPUT.with_suffix(".zip.sha256").write_text(f"{checksum}  {OUTPUT.name}\n")
receipt = {"artifact": OUTPUT.name, "bytes": OUTPUT.stat().st_size, "sha256": checksum, "members_checked": len(manifest), "zip_crc": "passed", "content_sha256": "passed", "executable_format": "PE x64", "windows_runtime_test": "NOT_RUN"}
(DIST / "delivery-manifest.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(receipt, ensure_ascii=False, indent=2))
