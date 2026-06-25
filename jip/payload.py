"""JIP payload — the data contract threaded between JIP nodes (#2).

All inter-node state travels on this payload (carried on a custom `JIP_PAYLOAD`
pin); JIP nodes never use hidden globals. A node consumes a payload, derives new
images/names, and emits a (shallow-copied) payload so optional nodes can be
skipped or reordered in the chain.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from comfy_api.v0_0_2 import io


@dataclass
class JIPPayload:
    # Working images as torch tensors shaped [1, H, W, C] in range [0, 1].
    images: list[Any] = field(default_factory=list)
    # Parallel output-name suffixes; "" = base image, "_alt", "_depthanythingv2", …
    names: list[str] = field(default_factory=list)
    # Current working dimensions (width, height).
    dims: tuple[int, int] = (0, 0)
    # Destination base root label, e.g. "Comfy Install" or "Extra Path 1" (#19).
    base_root: str = "Comfy Install"
    output_path: str = "cnets/"
    output_name: str = ""
    # When True, JIP Save deletes the source input file from disk after a
    # successful save — os.remove, no copy into the output dir (#20, #42).
    consume: bool = False
    # Absolute path of the source image from JIP Load (for consume).
    source_path: str = ""

    def copy(self) -> "JIPPayload":
        return JIPPayload(
            images=list(self.images),
            names=list(self.names),
            dims=self.dims,
            base_root=self.base_root,
            output_path=self.output_path,
            output_name=self.output_name,
            consume=self.consume,
            source_path=self.source_path,
        )

    # -- role accessors (#17) -------------------------------------------------
    # name "" = the immutable original base (from JIP Load, never mutated);
    # "_alt" = the working / "filtered" image (after Resize and/or RMBG);
    # "_<preproc>" = one per CNet preprocessor output.

    def base_image(self):
        """The original base image, or None if the payload is empty."""
        return self.images[0] if self.images else None

    def working_image(self):
        """The filtered working image: the ``_alt`` entry if present, else base.

        Returns base when no edit has happened — so "prep" is always defined.
        """
        for img, nm in zip(self.images, self.names):
            if nm == "_alt":
                return img
        return self.base_image()

    def set_working(self, tensor) -> None:
        """Write the working image to ``_alt`` (create it; never overwrite base)."""
        for i, nm in enumerate(self.names):
            if nm == "_alt":
                self.images[i] = tensor
                return
        self.images.append(tensor)
        self.names.append("_alt")

    def preprocessor_outputs(self) -> list[tuple[str, "object"]]:
        """``[(preproc_name, tensor)]`` for each ``_<preproc>`` entry (name without _)."""
        return [(nm[1:], img) for img, nm in zip(self.images, self.names)
                if nm and nm not in ("", "_alt")]


# Custom IO type that carries a JIPPayload between JIP nodes.
JIPPayloadIO = io.Custom("JIP_PAYLOAD")
