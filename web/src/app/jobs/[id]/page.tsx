import Link from "next/link";
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
          <Link href="/">Studio</Link>
          <span aria-hidden="true">/</span>
          <Link href="/library">Library</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Job workspace</span>
        </nav>
        <span>EDIT / REVIEW</span>
      </div>
      <JobStudio jobId={id} />
    </main>
  );
}
