import { PageHeader, EmptyState } from "@/components/ui";

export function ComingSoon({
  title, sub, phase, body,
}: { title: string; sub: string; phase: string; body: string }) {
  return (
    <>
      <PageHeader title={title} sub={sub} />
      <EmptyState title={`Arrives in ${phase}`} body={body} />
    </>
  );
}
