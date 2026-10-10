import { JobStudio } from "@/components/JobStudio";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <JobStudio jobId={id} />
    </main>
  );
}
