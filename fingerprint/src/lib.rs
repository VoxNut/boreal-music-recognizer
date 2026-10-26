mod fingerprinting {
    pub mod algorithm;
    pub mod hanning;
    pub mod signature_format;
}

use fingerprinting::algorithm::SignatureGenerator;
use wasm_bindgen::prelude::*;

fn encode(samples: &[f32]) -> Result<String, &'static str> {
    if !(6 * 16000..=15 * 16000).contains(&samples.len()) {
        return Err("Expected 6–15 seconds of mono audio at 16 kHz.");
    }
    if samples
        .iter()
        .any(|sample| !sample.is_finite() || sample.abs() > 1.0)
    {
        return Err("Audio contains invalid PCM samples.");
    }
    // shortcut: the unofficial service rejects 15 s signatures; use the final 12 s until longer signatures work.
    let samples = &samples[samples.len().saturating_sub(12 * 16000)..];
    SignatureGenerator::make_signature_from_buffer(samples)
        .encode_to_uri()
        .map_err(|_| "Could not encode the audio fingerprint.")
}

#[wasm_bindgen]
pub fn fingerprint(samples: &[f32]) -> Result<String, JsValue> {
    encode(samples).map_err(JsValue::from_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fingerprinting::signature_format::DecodedSignature;

    #[test]
    fn signature_round_trips_all_listening_lengths() {
        for seconds in [6, 10, 15] {
            let samples: Vec<f32> = (0..seconds * 16000)
                .map(|i| (i as f32 * 0.17).sin() * 0.5)
                .collect();
            let uri = encode(&samples).unwrap();
            let signature = DecodedSignature::decode_from_uri(&uri).unwrap();
            assert_eq!(signature.sample_rate_hz, 16000);
            assert_eq!(
                signature.number_samples,
                samples.len().min(12 * 16000) as u32
            );
            assert_eq!(signature.encode_to_uri().unwrap(), uri);
        }
    }

    #[test]
    fn rejects_unbounded_or_invalid_input() {
        assert!(encode(&[]).is_err());
        assert!(encode(&vec![0.0; 15 * 16000 + 1]).is_err());
        assert!(encode(&vec![f32::NAN; 6 * 16000]).is_err());
        assert!(encode(&vec![2.0; 6 * 16000]).is_err());
    }
}
