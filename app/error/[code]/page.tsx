import { HttpErrorView, HTTP_ERROR_META, type HttpErrorCode } from "@/components/HttpErrorView";

const VALID_CODES = Object.keys(HTTP_ERROR_META).map(Number) as HttpErrorCode[];

export function generateStaticParams() {
  return VALID_CODES.map((code) => ({ code: String(code) }));
}

export default async function HttpErrorPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parsed = Number(code);
  const valid = (VALID_CODES as number[]).includes(parsed) ? (parsed as HttpErrorCode) : null;
  if (!valid) {
    return <HttpErrorView code={404} note={`No error page exists for "${code}".`} />;
  }
  return <HttpErrorView code={valid} />;
}
