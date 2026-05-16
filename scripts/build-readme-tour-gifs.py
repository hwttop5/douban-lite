from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

from PIL import Image


DEFAULT_DURATION_MS = 1500

TARGETS = {
    "desktop": {
        "input_dir": "output/readme-tour/desktop",
        "output": "docs/screenshots/feature-tour.gif",
        "size": (1512, 982),
    },
    "tablet": {
        "input_dir": "output/readme-tour/tablet",
        "output": "docs/screenshots/feature-tour-tablet.gif",
        "size": (980, 1194),
    },
    "mobile": {
        "input_dir": "output/readme-tour/mobile",
        "output": "docs/screenshots/feature-tour-mobile.gif",
        "size": (440, 956),
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build README feature tour GIFs from captured PNG frames.")
    parser.add_argument(
        "--root",
        default=".",
        help="Workspace root containing output/readme-tour and docs/screenshots.",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=DEFAULT_DURATION_MS,
        help=f"Frame duration in milliseconds. Defaults to {DEFAULT_DURATION_MS}.",
    )
    parser.add_argument(
        "--targets",
        nargs="+",
        choices=sorted(TARGETS.keys()),
        default=sorted(TARGETS.keys()),
        help="Targets to build. Defaults to desktop tablet mobile.",
    )
    return parser.parse_args()


def sorted_frames(directory: Path) -> list[Path]:
    frames = sorted(directory.glob("*.png"))
    if not frames:
        raise FileNotFoundError(f"No PNG frames found in {directory}")
    return frames


def fit_and_center(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_width, target_height = size
    source = image.convert("RGBA")
    scale = min(target_width / source.width, target_height / source.height)
    resized = source.resize(
        (max(1, round(source.width * scale)), max(1, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", size, (238, 244, 239, 255))
    offset_x = (target_width - resized.width) // 2
    offset_y = (target_height - resized.height) // 2
    canvas.alpha_composite(resized, (offset_x, offset_y))
    return canvas


def quantize_frames(frames: Iterable[Image.Image]) -> list[Image.Image]:
    return [frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=256) for frame in frames]


def build_target(root: Path, target: str, duration_ms: int) -> None:
    config = TARGETS[target]
    input_dir = root / config["input_dir"]
    output_path = root / config["output"]
    size = config["size"]
    frame_paths = sorted_frames(input_dir)
    prepared_rgba_frames: list[Image.Image] = []
    for frame_path in frame_paths:
        with Image.open(frame_path) as frame:
            prepared_rgba_frames.append(fit_and_center(frame, size))
    prepared_frames = quantize_frames(prepared_rgba_frames)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    first_frame, *rest_frames = prepared_frames
    first_frame.save(
        output_path,
        save_all=True,
        append_images=rest_frames,
        duration=duration_ms,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"Built {target}: {output_path} ({len(prepared_frames)} frames, {size[0]}x{size[1]})")


def main() -> None:
    args = parse_args()
    root = Path(args.root).resolve()
    for target in args.targets:
        build_target(root, target, args.duration)


if __name__ == "__main__":
    main()
