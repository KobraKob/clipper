from unittest.mock import patch

import pytest

from clipper.ingest import is_youtube_url, validate_public_media_url


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/video.mp4",
        "http://localhost/video.mp4",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.4/video.mp4",
        "https://[::1]/video.mp4",
        "ftp://example.com/video.mp4",
        "http://user:password@example.com/video.mp4",
        "http://example.com:8080/video.mp4",
        "http://media.internal/video.mp4",
    ],
)
def test_rejects_private_or_unsafe_source_urls(url):
    with pytest.raises(ValueError):
        validate_public_media_url(url)


def test_accepts_public_ip_literal():
    validate_public_media_url("https://93.184.216.34/video.mp4")


def test_rejects_hostname_resolving_to_private_address():
    records = [
        (2, 1, 6, "", ("127.0.0.1", 443)),
        (2, 1, 6, "", ("93.184.216.34", 443)),
    ]
    with patch("clipper.ingest.socket.getaddrinfo", return_value=records):
        with pytest.raises(ValueError, match="Private"):
            validate_public_media_url("https://cdn.examplevideo.com/video.mp4")


def test_accepts_hostname_resolving_only_to_public_addresses():
    records = [(2, 1, 6, "", ("93.184.216.34", 443))]
    with patch("clipper.ingest.socket.getaddrinfo", return_value=records):
        validate_public_media_url("https://cdn.examplevideo.com/video.mp4")


def test_youtube_host_matching_uses_dns_label_boundaries():
    assert is_youtube_url("https://www.youtube.com/watch?v=abc")
    assert is_youtube_url("https://youtu.be/abc")
    assert not is_youtube_url("https://notyoutube.com/video")
    assert not is_youtube_url("https://youtube.com.attacker.example/video")
