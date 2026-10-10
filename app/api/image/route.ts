import { authenticated, failure, noStore } from "@/lib/server/http";
import { AppError, input } from "@/lib/server/core";
import { bucket, getSense, publicSense } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await authenticated();
    const params = new URL(request.url).searchParams;
    const sense = publicSense(await getSense(user.userId, input(params.get("senseId"), "词义编号", 80)));
    const materialId = input(params.get("materialId"), "材料编号", 80);
    const scene = sense.materials.find(item => item.id === materialId)?.scene;
    if (!scene?.objectKey) throw new AppError("图片尚未生成。", 404, "NOT_FOUND");
    const object = await bucket().get(scene.objectKey);
    if (!object) throw new AppError("图片暂时无法读取，请重试。", 404, "NOT_FOUND");
    const mimeType = object.httpMetadata?.contentType;
    if (!mimeType || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new AppError("图片格式无效。", 502, "IMAGE_FORMAT");
    return new Response(object.body, { headers: { ...noStore, "Content-Type": mimeType, "Content-Length": String(object.size), "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
