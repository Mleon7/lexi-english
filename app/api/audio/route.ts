import { authenticated, failure, noStore } from "@/lib/server/http";
import { AppError, input } from "@/lib/server/core";
import { database, bucket } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await authenticated();
    const id = input(new URL(request.url).searchParams.get("id"), "音频编号", 80);
    const file = await database().prepare("SELECT cache_key FROM audio_files WHERE id=? AND user_id=?").bind(id, user.userId).first<{ cache_key: string }>();
    if (!file) throw new AppError("音频不存在。", 404, "NOT_FOUND");
    const object = await bucket().get(file.cache_key);
    if (!object) throw new AppError("音频暂时无法读取，请重新生成。", 404, "NOT_FOUND");
    const wav = file.cache_key.endsWith(".wav");
    return new Response(object.body, { headers: { ...noStore, "Content-Type": wav ? "audio/wav" : "audio/mpeg", "Content-Length": String(object.size), "Content-Disposition": `inline; filename=practice.${wav ? "wav" : "mp3"}` } });
  } catch (error) { return failure(error); }
}
