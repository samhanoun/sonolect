# Sonolect Studio design direction

Target: Windows voice workspace, local-first with explicit online providers. New Models & voices page plus shared shell. Primary inspiration: Superdesign mosaic-grid-architecture-style.

Palette: ivory #F5F6F2 main canvas, white #FFFFFF surfaces, forest #1F3429 primary, lime #DDF39A quiet accent, text #202923, muted #6C766E, hairline #E0E6DD. Dark forest sidebar. No gradients/glass effects. Segoe UI/Arial locally available fonts, 14px body, 32px main title, 11px section labels; 4/8/12/16/24/32px spacing; 12px card radius. Native-feeling, calm, spacious, clear hierarchy.

Navigation: Overview, Transcribe, Text to speech, Library, Dictionary, Snippets, Models & voices, Settings. Header: processing mode and model summary. Provider cards: key saved or absent (never fabricated connected state), OpenRouter speech support, OpenCode Zen text-model support, local Whisper. Model selector filters by actual capability. Keys are masked and kept in Windows Credential Manager. Voice playback is manual; no audio starts automatically.

No customer stats, fake history, fake model prices or fabricated connection success. Empty/loading/error/saved states required. Keyboard focus visible. Reduced motion respected. Model download is distinct from cloud inference.
