declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DEEPSEEK_API_KEY?: string;
    MINIMAX_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
    MINIMAX_MODEL?: string;
    MINIMAX_IMAGE_MODEL?: string;
  }
}
