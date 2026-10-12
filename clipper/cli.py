"""
Command-line interface (CLI) for the Open-Source Video Clipper.
Built with Typer and Rich for clear interactive terminal output.
"""

from __future__ import annotations

import json
import logging
import pathlib
import sys
from typing import Optional

# Ensure UTF-8 streams on Windows to prevent UnicodeEncodeError with non-ASCII clip titles/quotes
if sys.platform == "win32":
    try:
        if sys.stdout and hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if sys.stderr and hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .config import Settings, settings as default_settings
from .cut import cut
from .pipeline import get_transcript, rerender_clip, run_pipeline
from .scoring import rank
from .candidates import build_candidates, prefilter

app = typer.Typer(
    name="clipper",
    help="AI Video Clipper: Extract vertical high-retention clips with animated subtitles.",
    add_completion=False,
)
console = Console(highlight=False, legacy_windows=False)


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
        None, "--provider", "-p", help="Provider switch ('local', 'groq', or 'openrouter'). Overrides .env."
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
    caption_style: Optional[str] = typer.Option(
        None, "--caption-style", "-s", help="Caption look (see `caption-styles`). Default from CAPTION_STYLE in .env."
    ),
    caption_position: Optional[str] = typer.Option(
        None, "--caption-position", help="Override caption position: bottom | middle | top."
    ),
    layout: Optional[str] = typer.Option(
        None, "--layout", help="fill = face-tracked full-screen crop (default) | fit_blur = whole frame on blurred backdrop."
    ),
    seo: Optional[bool] = typer.Option(
        None, "--seo/--no-seo", help="Generate title, description and hashtags for every clip."
    ),
    min_height: Optional[int] = typer.Option(
        None, "--min-height", help="Minimum source resolution to download (short side). Default 1080."
    ),
    encoder: Optional[str] = typer.Option(
        None, "--encoder", help="Video encoder: auto | h264_nvenc | libx264 | h264_qsv."
    ),
    trim_silence: bool = typer.Option(
        False, "--trim-silence/--no-trim-silence", help="Trim pauses >0.4s and filler words (um/uh)."
    ),
    hook_overlay: bool = typer.Option(
        True, "--hook-overlay/--no-hook-overlay", help="Big opening hook headline for first 2.5s."
    ),
    progress_bar: bool = typer.Option(
        False, "--progress-bar/--no-progress-bar", help="Animated bottom progress bar."
    ),
    loudnorm: bool = typer.Option(
        True, "--loudnorm/--no-loudnorm", help="Normalize audio loudness to -14 LUFS."
    ),
    cover: bool = typer.Option(
        True, "--cover/--no-cover", help="Extract sharpest thumbnail cover frame."
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose debug logging."),
) -> None:
    """Run full automated clipping pipeline."""
    _setup_logging(verbose)
    console.print(
        Panel.fit(
            f"[bold cyan]AI Video Clipper[/bold cyan]\n"
            f"[yellow]Source:[/yellow] {source}\n"
            f"[yellow]Clips requested:[/yellow] {clips} | [yellow]Provider:[/yellow] {provider or default_settings.provider}\n"
            f"[yellow]Vertical 9:16:[/yellow] {vertical} | [yellow]Captions:[/yellow] {captions}\n"
            f"[yellow]Encoder:[/yellow] {encoder or default_settings.video_encoder}\n"
            f"[yellow]Retention:[/yellow] Hook: {hook_overlay} | Loudnorm: {loudnorm} | Trim: {trim_silence} | Progress: {progress_bar}",
            title="Pipeline Initializing",
        )
    )

    custom_settings = Settings.create_custom(
        provider=provider,
        shortlist=shortlist,
        caption_position=caption_position,
        min_source_height=min_height,
        video_encoder=encoder,
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
            caption_style=caption_style,
            layout=layout,
            seo=seo,
            encoder=encoder,
            trim_silence=trim_silence,
            hook_overlay=hook_overlay,
            progress_bar=progress_bar,
            loudnorm=loudnorm,
            cover_frame=cover,
        )

        try:
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
                    str(c["title"]),
                    f"{c['duration']}s",
                    pathlib.Path(c["file"]).name,
                )

            console.print(table)
            console.print(
                f"\n[bold green]Success![/bold green] All clips exported to [cyan]{pathlib.Path(outdir).resolve()}[/cyan]"
            )
        except Exception:
            # Table printing formatting failure must never fail an already-completed pipeline
            print(f"Success! {len(manifest.get('clips', []))} clips exported to {pathlib.Path(outdir).resolve()}")

    except Exception as exc:
        console.print(f"[bold red]Error running pipeline:[/bold red] {exc}")
        if verbose:
            console.print_exception()
        raise typer.Exit(code=1)


@app.command("caption-styles")
def caption_styles(
    as_json: bool = typer.Option(False, "--json", help="Machine-readable output (used by the web UI)."),
) -> None:
    """List the available caption styles."""
    import json as _json

    from .captions import list_styles

    styles = list_styles()
    if as_json:
        typer.echo(_json.dumps(styles))
        return
    table = Table(title="Caption styles", header_style="bold magenta")
    table.add_column("Key", style="cyan")
    table.add_column("Name")
    table.add_column("Look")
    for st in styles:
        table.add_row(st["key"], st["label"], st["description"])
    console.print(table)


@app.command()
def publish(
    manifest: str = typer.Argument(..., help="Path to the outputs/metadata.json written by `run`."),
    rank: int = typer.Option(..., "--rank", "-r", help="Clip rank to publish (see the manifest)."),
    platform: str = typer.Option("both", "--platform", "-p", help="youtube | instagram | both"),
    privacy: Optional[str] = typer.Option(None, "--privacy", help="YouTube privacy: private | unlisted | public."),
    reauth: bool = typer.Option(False, "--reauth", help="Force re-authentication with Google/YouTube account."),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Upload a finished clip to YouTube Shorts and/or Instagram Reels using its generated metadata."""
    import json as _json

    from .config import settings as _settings
    from .publish import PublishError, update_manifest

    _setup_logging(verbose)
    targets = ["youtube", "instagram"] if platform == "both" else [platform]

    def _cli_progress(plat: str, frac: float):
        if frac < 0:
            console.print(f"[bold red][upload] {plat.capitalize()} upload failed.[/bold red]")
        elif frac >= 1.0:
            console.print(f"[bold green][upload] {plat.capitalize()} upload complete (100%).[/bold green]")
        else:
            pct = max(0, min(99, int(frac * 100)))
            console.print(f"[cyan][upload] {plat.capitalize()} progress: {pct}%[/cyan]")

    try:
        result = update_manifest(pathlib.Path(manifest), rank, targets, _settings, privacy, on_progress=_cli_progress, force_reauth=reauth)
    except PublishError as exc:
        console.print(f"[bold red]Publish failed:[/bold red] {exc}")
        raise typer.Exit(code=1)
    typer.echo(_json.dumps(result, indent=2))
    if any(v.get("status") == "error" for v in result.values() if v.get("status")):
        raise typer.Exit(code=2)


@app.command()
def rerender(
    manifest: str = typer.Argument(..., help="Path to outputs/<job_id>/metadata.json."),
    rank: int = typer.Option(..., "--rank", "-r", help="Rank number of the clip to re-render."),
    start: float = typer.Option(..., "--start", "-s", help="New start timestamp in seconds."),
    end: float = typer.Option(..., "--end", "-e", help="New end timestamp in seconds."),
    layout: Optional[str] = typer.Option(None, "--layout", help="Override layout: fill | fit_blur | original."),
    caption_style: Optional[str] = typer.Option(None, "--caption-style", help="Override caption style."),
    encoder: Optional[str] = typer.Option(None, "--encoder", help="Override video encoder: auto | h264_nvenc | libx264 | h264_qsv."),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Re-render an edited clip with new timestamps, reusing the cached transcript."""
    _setup_logging(verbose)

    try:
        updated = rerender_clip(
            manifest_path=pathlib.Path(manifest),
            rank=rank,
            start=start,
            end=end,
            layout=layout,
            caption_style=caption_style,
            encoder=encoder,
        )
        console.print(
            f"[bold green]Re-render complete![/bold green] Clip {rank} duration: {updated['duration']}s -> {updated['file']}"
        )
    except Exception as exc:
        console.print(f"[bold red]Re-render failed:[/bold red] {exc}")
        if verbose:
            console.print_exception()
        raise typer.Exit(code=1)


@app.command()
def schedule(
    manifest: str = typer.Argument(..., help="Path to outputs/<job_id>/metadata.json."),
    rank: int = typer.Option(..., "--rank", "-r", help="Clip rank to schedule."),
    time: str = typer.Option(..., "--time", "-t", help="Target UTC ISO time (e.g. 2026-10-15T18:00:00Z)."),
    platform: str = typer.Option("youtube", "--platform", "-p", help="youtube | instagram | both"),
) -> None:
    """Schedule a finished clip for automated distribution at a specific time."""
    from .distribution import schedule_clip_post
    try:
        schedule_clip_post(pathlib.Path(manifest), rank, platform, time)
        console.print(f"[bold green]Clip #{rank} scheduled for {time} on {platform}![/bold green]")
    except Exception as exc:
        console.print(f"[bold red]Scheduling failed:[/bold red] {exc}")
        raise typer.Exit(code=1)


@app.command(name="process-queue")
def process_queue(
    outdir: str = typer.Option("outputs", "--outdir", "-o", help="Outputs directory to scan."),
) -> None:
    """Check posting queue and upload clips whose scheduled time has arrived."""
    from .config import settings as _s
    from .distribution import process_posting_queue
    results = process_posting_queue(pathlib.Path(outdir), _s)
    console.print(f"[bold cyan]Queue check complete: {len(results)} items processed.[/bold cyan]")


@app.command()
def analytics(
    manifest: str = typer.Argument(..., help="Path to outputs/<job_id>/metadata.json."),
) -> None:
    """Fetch live YouTube performance analytics for published clips in a job."""
    from .config import settings as _s
    from .distribution import refresh_manifest_analytics
    try:
        data = refresh_manifest_analytics(pathlib.Path(manifest), _s)
        console.print(f"[bold green]Analytics updated for {len(data.get('clips', []))} clips![/bold green]")
    except Exception as exc:
        console.print(f"[bold red]Analytics refresh failed:[/bold red] {exc}")
        raise typer.Exit(code=1)


@app.command()
def transcribe(
    source: str = typer.Argument(..., help="Path to video or audio file."),
    provider: Optional[str] = typer.Option(None, "--provider", "-p", help="Provider ('local', 'groq', or 'openrouter')."),
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
    provider: Optional[str] = typer.Option(None, "--provider", "-p", help="LLM Provider ('local', 'groq', or 'openrouter')."),
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
