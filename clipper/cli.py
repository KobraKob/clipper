"""
Command-line interface (CLI) for the Open-Source Video Clipper.
Built with Typer and Rich for clear interactive terminal output.
"""

from __future__ import annotations

import json
import logging
import pathlib
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .config import Settings, settings as default_settings
from .cut import cut
from .pipeline import get_transcript, run_pipeline
from .scoring import rank
from .candidates import build_candidates, prefilter

app = typer.Typer(
    name="clipper",
    help="AI Video Clipper: Extract vertical high-retention clips with animated subtitles.",
    add_completion=False,
)
console = Console()


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )


@app.command()
def run(
    source: str = typer.Argument(..., help="Path to local video file or URL (YouTube, etc.)."),
    clips: int = typer.Option(5, "--clips", "-n", help="Number of top clips to export."),
    provider: Optional[str] = typer.Option(
        None, "--provider", "-p", help="Provider switch ('local' or 'groq'). Overrides .env."
    ),
    vertical: bool = typer.Option(
        True, "--vertical/--no-vertical", help="Reframe clips into 9:16 vertical video with face tracking."
    ),
    captions: bool = typer.Option(
        True, "--captions/--no-captions", help="Burn word-by-word animated karaoke subtitles."
    ),
    workdir: str = typer.Option("workdir", "--workdir", "-w", help="Working cache directory."),
    outdir: str = typer.Option("outputs", "--outdir", "-o", help="Final clips destination directory."),
    shortlist: Optional[int] = typer.Option(None, "--shortlist", help="Shortlist size for stage 2 strong LLM."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose debug logging."),
) -> None:
    """Run full automated clipping pipeline."""
    _setup_logging(verbose)
    console.print(
        Panel.fit(
            f"[bold cyan]AI Video Clipper[/bold cyan]\n"
            f"[yellow]Source:[/yellow] {source}\n"
            f"[yellow]Clips requested:[/yellow] {clips} | [yellow]Provider:[/yellow] {provider or default_settings.provider}\n"
            f"[yellow]Vertical 9:16:[/yellow] {vertical} | [yellow]Captions:[/yellow] {captions}",
            title="Pipeline Initializing",
        )
    )

    custom_settings = Settings.create_custom(
        provider=provider,
        shortlist=shortlist,
    )

    try:
        manifest = run_pipeline(
            source=source,
            n_clips=clips,
            vertical=vertical,
            captions=captions,
            work_dir=pathlib.Path(workdir),
            output_dir=pathlib.Path(outdir),
            app_settings=custom_settings,
        )

        table = Table(title="Generated Clips Summary", show_header=True, header_style="bold green")
        table.add_column("Rank", style="dim", width=6)
        table.add_column("Score", justify="right", width=7)
        table.add_column("Title", style="bold")
        table.add_column("Duration", justify="right", width=10)
        table.add_column("File", style="cyan")

        for c in manifest.get("clips", []):
            table.add_row(
                str(c["rank"]),
                f"{c['score']}/100",
                c["title"],
                f"{c['duration']}s",
                pathlib.Path(c["file"]).name,
            )

        console.print(table)
        console.print(
            f"\n[bold green]Success![/bold green] All clips exported to [cyan]{pathlib.Path(outdir).resolve()}[/cyan]"
        )

    except Exception as exc:
        console.print(f"[bold red]Error running pipeline:[/bold red] {exc}")
        if verbose:
            console.print_exception()
        raise typer.Exit(code=1)


@app.command()
def transcribe(
    source: str = typer.Argument(..., help="Path to video or audio file."),
    provider: Optional[str] = typer.Option(None, "--provider", "-p", help="Provider ('local' or 'groq')."),
    workdir: str = typer.Option("workdir", "--workdir", "-w", help="Working cache directory."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose logs."),
) -> None:
    """Extract audio and transcribe, writing transcript.json to workdir."""
    _setup_logging(verbose)
    from .ingest import extract_audio, is_url, download

    job_path = pathlib.Path(workdir) / "transcribe_job"
    job_path.mkdir(parents=True, exist_ok=True)

    if is_url(source):
        video = download(source, job_path)
    else:
        video = pathlib.Path(source)

    wav = job_path / "audio.wav"
    if not wav.exists():
        extract_audio(video, wav)

    custom_settings = Settings.create_custom(provider=provider)
    data = get_transcript(wav, job_path, s=custom_settings)

    console.print(
        f"[green]Transcription complete![/green] Language: [cyan]{data.get('language')}[/cyan], "
        f"Segments: [cyan]{len(data.get('segments', []))}[/cyan]"
    )
    console.print(f"Saved to: [bold]{job_path / 'transcript.json'}[/bold]")


@app.command()
def score_only(
    transcript_file: str = typer.Argument(..., help="Path to existing transcript.json."),
    clips: int = typer.Option(5, "--clips", "-n", help="Number of clips to select."),
    provider: Optional[str] = typer.Option(None, "--provider", "-p", help="LLM Provider ('local' or 'groq')."),
) -> None:
    """Score candidates from an existing transcript.json without video re-encoding."""
    p = pathlib.Path(transcript_file)
    if not p.exists():
        console.print(f"[red]Transcript file not found:[/red] {transcript_file}")
        raise typer.Exit(code=1)

    data = json.loads(p.read_text(encoding="utf-8"))
    segments = data.get("segments", [])
    custom_settings = Settings.create_custom(provider=provider)

    from .providers import get_llm

    llm = get_llm(custom_settings)
    cands = prefilter(build_candidates(segments))
    top = rank(cands, llm, n=clips, shortlist_size=custom_settings.shortlist)

    table = Table(title="Scored Clip Recommendations", show_header=True, header_style="bold blue")
    table.add_column("Rank", width=5)
    table.add_column("Score", width=7)
    table.add_column("Time Window", width=16)
    table.add_column("Title")
    table.add_column("Hook")

    for idx, c in enumerate(top, 1):
        table.add_row(
            str(idx),
            f"{c.get('score', 0)}/100",
            f"{c['start']:.1f}s - {c['end']:.1f}s",
            c.get("title", ""),
            c.get("hook", "")[:50] + "...",
        )

    console.print(table)


@app.command()
def cut_clip(
    source: str = typer.Argument(..., help="Path to video."),
    start: float = typer.Option(..., "--start", "-s", help="Start time in seconds."),
    end: float = typer.Option(..., "--end", "-e", help="End time in seconds."),
    output: str = typer.Option("cut.mp4", "--out", "-o", help="Output file path."),
) -> None:
    """Perform frame-accurate cutting on a video clip."""
    out_path = pathlib.Path(output)
    cut(pathlib.Path(source), start, end, out_path)
    console.print(f"[green]Cut saved to:[/green] [bold]{out_path.resolve()}[/bold]")


if __name__ == "__main__":
    app()
