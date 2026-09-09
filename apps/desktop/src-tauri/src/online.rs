#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn speech_endpoints_are_fixed_and_zen_speech_is_rejected() {
        assert_eq!(speech_endpoint("openrouter", "stt").unwrap(), "https://openrouter.ai/api/v1/audio/transcriptions");
        assert_eq!(speech_endpoint("openrouter", "tts").unwrap(), "https://openrouter.ai/api/v1/audio/speech");
        assert!(speech_endpoint("opencode", "stt").is_err());
        assert!(speech_endpoint("https://example.test", "tts").is_err());
    }

    #[test]
    fn catalogs_only_offer_declared_speech_capabilities() {
        let models = parse_models("openrouter", &json!({"data":[
            {"id":"vendor/stt","name":"Recognizer","architecture":{"output_modalities":["transcription"]}},
            {"id":"vendor/tts","architecture":{"output_modalities":["speech"]},"supported_voices":["voice-a"]},
            {"id":"vendor/chat","architecture":{"output_modalities":["text"]}},
            {"id":null}, {"id":"unknown/no-metadata"}
        ]})).unwrap();
        assert_eq!(models.len(), 3);
        assert_eq!(models[0].capabilities, vec!["stt"]);
        assert_eq!(models[1].voices, vec!["voice-a"]);
        assert_eq!(models[2].capabilities, vec!["text"]);
    }

    #[test]
    fn zen_catalog_is_never_misrepresented_as_speech() {
        let models = parse_models("opencode", &json!({"data":[{"id":"gpt-5"}]})).unwrap();
        assert_eq!(models[0].capabilities, vec!["text"]);
    }

    #[test]
    fn local_policy_and_invalid_credentials_fail_closed() {
        assert!(guard_cloud(false).is_err());
        assert!(guard_cloud(true).is_ok());
        for key in ["", "key\nvalue", "key with spaces"] { assert!(validate_key(key).is_err()); }
        assert_eq!(validate_key(" valid-test-key ").unwrap(), "valid-test-key");
    }

    #[test]
    fn transcription_uses_json_base64_and_omits_auto_language() {
        let body = transcription_body("vendor/stt", &[0, 1, 2], Some("auto"));
        assert_eq!(body["input_audio"]["data"], "AAEC");
        assert_eq!(body["input_audio"]["format"], "wav");
        assert!(body.get("language").is_none());
        assert_eq!(transcription_body("vendor/stt", &[1], Some("fr-FR"))["language"], "fr");
    }
}
