#!/usr/bin/env python3
"""Behavioral regression tests for the streamed image-rootfs policy."""

from __future__ import annotations

import io
import subprocess
import sys
import tarfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).with_name("verify-image-rootfs.py")
WORKER_ENTRYPOINT = "app/dist/index.js"


def rootfs_tar(*paths: str) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for path in paths:
            payload = b"runtime-content"
            member = tarfile.TarInfo(path)
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
    return stream.getvalue()


def run_checker(target: str, *paths: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, str(CHECKER), target],
        input=rootfs_tar(*paths),
        capture_output=True,
        check=False,
    )


def temporal_path(relative: str) -> str:
    return (
        "app/node_modules/.pnpm/@temporalio+core-bridge@1.13.2/"
        f"node_modules/@temporalio/core-bridge/{relative}"
    )


class RootfsPolicyTests(unittest.TestCase):
    def assert_rejected(self, target: str, prohibited: str, message: str) -> None:
        result = run_checker(target, WORKER_ENTRYPOINT, prohibited)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr.decode())

    def test_allows_test_named_file_owned_by_third_party_pnpm_package(self) -> None:
        result = run_checker(
            "worker",
            WORKER_ENTRYPOINT,
            "app/node_modules/.pnpm/example@1.0.0/node_modules/example/lib/parser.test.js",
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_rejects_first_party_test_file_even_when_nested_below_node_modules(self) -> None:
        self.assert_rejected(
            "worker",
            "app/node_modules/@ventureos/workflows/src/client.test.js",
            "forbidden first-party test file",
        )

    def test_rejects_first_party_spec_file(self) -> None:
        self.assert_rejected(
            "worker", "app/dist/runtime.spec.js", "forbidden first-party test file"
        )

    def test_rejects_git_content(self) -> None:
        self.assert_rejected("worker", "app/.git/config", "forbidden .git content")

    def test_rejects_environment_file(self) -> None:
        self.assert_rejected("worker", "app/.env.production", "forbidden environment file")

    def test_rejects_vitest_in_pnpm_virtual_store(self) -> None:
        self.assert_rejected(
            "worker",
            "app/node_modules/.pnpm/vitest@3.2.7/node_modules/vitest/index.js",
            "forbidden development-only runtime package",
        )

    def test_rejects_target_specific_type_only_runtime_packages(self) -> None:
        cases = (
            (
                "api",
                "app/dist/main.js",
                "app/node_modules/.pnpm/@types+node@22.20.1/node_modules/@types/node/index.d.ts",
            ),
            (
                "worker",
                WORKER_ENTRYPOINT,
                "app/node_modules/.pnpm/@types+estree@1.0.8/node_modules/@types/estree/index.d.ts",
            ),
            (
                "worker",
                WORKER_ENTRYPOINT,
                "app/node_modules/.pnpm/@types+json-schema@7.0.15/node_modules/@types/json-schema/index.d.ts",
            ),
            (
                "web",
                "app/apps/web/server.js",
                "app/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js",
            ),
        )
        for target, entrypoint, prohibited in cases:
            with self.subTest(target=target, prohibited=prohibited):
                result = run_checker(target, entrypoint, prohibited)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(
                    "forbidden development-only runtime package",
                    result.stderr.decode(),
                )

    def test_rejects_secret_like_content_inside_node_modules(self) -> None:
        secret_path = "app/node_modules/.pnpm/example@1.0.0/node_modules/example/token.js"
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as archive:
            for path, payload in (
                (WORKER_ENTRYPOINT, b"runtime-content"),
                (secret_path, b"ghp_12345678901234567890"),
            ):
                member = tarfile.TarInfo(path)
                member.size = len(payload)
                archive.addfile(member, io.BytesIO(payload))
        result = subprocess.run(
            [sys.executable, str(CHECKER), "worker"],
            input=stream.getvalue(),
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("secret-like content detected", result.stderr.decode())

    def test_rejects_temporal_sdk_core(self) -> None:
        self.assert_rejected(
            "worker", temporal_path("sdk-core/src/lib.rs"), "Temporal sdk-core remains"
        )

    def test_rejects_temporal_bridge_macros(self) -> None:
        self.assert_rejected(
            "worker", temporal_path("bridge-macros/src/lib.rs"), "Temporal bridge-macros remains"
        )

    def test_rejects_temporal_cargo_lock(self) -> None:
        self.assert_rejected(
            "worker", temporal_path("Cargo.lock"), "Temporal Cargo.lock remains"
        )

    def test_rejects_temporal_cargo_toml(self) -> None:
        self.assert_rejected(
            "worker", temporal_path("Cargo.toml"), "Temporal Cargo.toml remains"
        )

    def test_tools_rejects_source_directory_content(self) -> None:
        result = run_checker(
            "tools",
            "app/prisma/schema.prisma",
            "app/node_modules/prisma/build/index.js",
            "app/src/migration.ts",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden source directory", result.stderr.decode())


if __name__ == "__main__":
    unittest.main()
