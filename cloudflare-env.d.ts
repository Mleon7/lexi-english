declare namespace Cloudflare {
  interface Env {
    ALLOWED_ORIGINS?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DEEPSEEK_API_KEY?: string;
    MINIMAX_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
    MINIMAX_MODEL?: string;
    TTS_PROVIDER?: string;
    QWEN_TTS_URL?: string;
    QWEN_TTS_MODEL?: string;
    MINIMAX_IMAGE_MODEL?: string;
  }
}
