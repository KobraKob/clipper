import { JobStudio } from "@/components/JobStudio";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="app-page job-page">
      <div className="page-topline">
        <nav aria-label="Breadcrumb" className="page-breadcrumb">
          <a href="/">Studio</a>
          <span aria-hidden="true">/</span>
          <a href="/library">Library</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Job workspace</span>
        </nav>
        <span>EDIT / REVIEW</span>
      </div>
      <JobStudio jobId={id} />
    </main>
  );
}
