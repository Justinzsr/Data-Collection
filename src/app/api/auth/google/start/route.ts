import { handleGoogleLoginStart } from "@/storage/auth/google-login";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleGoogleLoginStart(request);
}
