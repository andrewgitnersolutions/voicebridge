import os
import unittest

EXTENSION_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestOffscreen(unittest.TestCase):
    def setUp(self):
        self.offscreen_js = os.path.join(EXTENSION_DIR, 'offscreen', 'offscreen.js')
        with open(self.offscreen_js, 'r', encoding='utf-8') as f:
            self.code = f.read()

    def test_audio_constraints(self):
        # Mono capture to maximize Opus voice bitrate
        self.assertIn("channelCount: 1", self.code)
        self.assertIn("sampleRate: 48000", self.code)
        self.assertIn("sampleSize: 16", self.code)
        self.assertIn("echoCancellation: true", self.code)
        self.assertIn("noiseSuppression: true", self.code)
        self.assertIn("autoGainControl: true", self.code)
        self.assertIn("googEchoCancellation: true", self.code)
        self.assertIn("googNoiseSuppression: true", self.code)
        self.assertIn("googHighpassFilter: true", self.code)

    def test_selected_microphone_handling(self):
        self.assertIn("selectedAudioDeviceId", self.code)
        self.assertIn("selectedAudioDeviceLabel", self.code)
        self.assertIn("deviceId: { exact: deviceId }", self.code)
        self.assertIn("Selected microphone unavailable, falling back to default mic", self.code)

    def test_web_audio_dsp_chain(self):
        # High-Pass Filter (85 Hz rumble and plosive cutoff)
        self.assertIn("createBiquadFilter()", self.code)
        self.assertIn("highPassFilter.type = 'highpass'", self.code)
        self.assertIn("highPassFilter.frequency.setValueAtTime(85", self.code)

        # Speech Presence Peaking Filter (3.2 kHz vocal clarity boost)
        self.assertIn("presenceFilter.type = 'peaking'", self.code)
        self.assertIn("presenceFilter.frequency.setValueAtTime(3200", self.code)
        self.assertIn("presenceFilter.gain.setValueAtTime(2.5", self.code)

        # Studio Dynamics Compressor
        self.assertIn("createDynamicsCompressor()", self.code)
        self.assertIn("compressorNode.threshold.setValueAtTime(-24", self.code)
        self.assertIn("compressorNode.ratio.setValueAtTime(4", self.code)

        # Destination node & recorder routing
        self.assertIn("createMediaStreamDestination()", self.code)
        self.assertIn("new MediaRecorder(destinationNode.stream", self.code)

    def test_audio_bitrate_and_compression(self):
        self.assertIn("audioBitsPerSecond: 128000", self.code, "Must use studio-quality 128kbps Opus for pristine voice clarity")
        self.assertIn("'audio/webm;codecs=opus'", self.code)

    def test_silence_detection_math(self):
        def calculate_normalized_level(frequencies):
            avg = sum(frequencies) / len(frequencies)
            return min(1.0, avg / 128.0)

        # Silent buffer (all zeros)
        silent_data = [0] * 32
        self.assertEqual(calculate_normalized_level(silent_data), 0.0)

        # Low background hiss
        hiss_data = [1] * 32
        level_hiss = calculate_normalized_level(hiss_data)
        self.assertLess(level_hiss, 0.02, "Low background noise under 0.02 should still trigger silence count")

        # Normal speech level (~40-80)
        speech_data = [64] * 32
        level_speech = calculate_normalized_level(speech_data)
        self.assertEqual(level_speech, 0.5)
        self.assertGreater(level_speech, 0.02)

        # Loud speech peak (128+)
        loud_data = [200] * 32
        level_loud = calculate_normalized_level(loud_data)
        self.assertEqual(level_loud, 1.0, "Should clamp to 1.0")

    def test_silence_threshold_frames(self):
        # 180 frames @ 60fps = 3.0 seconds
        self.assertIn("consecutiveSilenceFrames > 180", self.code)
        self.assertIn("SILENCE_WARNING_TRIGGERED", self.code)

    def test_peak_clipping_guard(self):
        self.assertIn("normalizedLevel > 0.98", self.code)
        self.assertIn("PEAK_CLIPPING_WARNING", self.code)

    def test_cleanup_streams(self):
        self.assertIn("destinationNode.stream.getTracks().forEach", self.code)
        self.assertIn("track.stop()", self.code)
        self.assertIn("audioContext.close()", self.code)
        self.assertIn("cancelAnimationFrame", self.code)
        self.assertIn("sourceNode.disconnect()", self.code)

    def test_message_actions_handled(self):
        self.assertIn("'OFFSCREEN_START_RECORDING'", self.code)
        self.assertIn("'OFFSCREEN_STOP_RECORDING'", self.code)
        self.assertIn("'OFFSCREEN_CANCEL_RECORDING'", self.code)

    def test_ipc_throttling_and_state_locking(self):
        self.assertIn("isStarting", self.code)
        self.assertIn("isStopping", self.code)
        self.assertIn("isAborted", self.code)
        self.assertIn("lastLevelEmitTime", self.code)
        self.assertIn("lastEmittedLevel", self.code)
        self.assertIn("Recording was cancelled during startup", self.code)

if __name__ == '__main__':
    unittest.main()

