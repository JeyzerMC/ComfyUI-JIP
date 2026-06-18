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

    def copy(self) -> "JIPPayload":
        return JIPPayload(
            images=list(self.images),
            names=list(self.names),
            dims=self.dims,
            base_root=self.base_root,
            output_path=self.output_path,
            output_name=self.output_name,
        )


# Custom IO type that carries a JIPPayload between JIP nodes.
JIPPayloadIO = io.Custom("JIP_PAYLOAD")
