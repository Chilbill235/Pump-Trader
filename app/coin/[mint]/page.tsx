import { CoinView } from "@/components/CoinView";

export default async function CoinPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  return <CoinView mint={mint} />;
}
