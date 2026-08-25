#!/usr/bin/env python3
"""
VoiceBridge Test Runner
Runs all unit, integration, accessibility, and build package tests.
"""

import os
import sys
import unittest
import time

def main():
    start_time = time.time()
    print("=" * 60)
    print("🎙️  VOICEBRIDGE CHROME EXTENSION TEST SUITE")
    print("=" * 60)

    test_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tests')
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=test_dir, pattern='test_*.py')

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    elapsed = time.time() - start_time
    print("=" * 60)
    print(f"📊 SUMMARY: {result.testsRun} tests run in {elapsed:.3f}s")
    if result.wasSuccessful():
        print("✅ ALL TESTS PASSED! Extension is ready for deployment.")
        sys.exit(0)
    else:
        print(f"❌ FAILURES: {len(result.failures)} | ERRORS: {len(result.errors)}")
        sys.exit(1)

if __name__ == '__main__':
    main()
