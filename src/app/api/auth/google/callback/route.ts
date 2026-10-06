import { handleGoogleLoginCallback } from "@/storage/auth/google-login";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleGoogleLoginCallback(request);
}
