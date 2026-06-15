"""JIP node classes."""

from .load import JIPLoad
from .rmbg import JIPRMBG
from .resize import JIPResize
from .cnet import JIPCNetPreprocess
from .save import JIPSave

NODES = [JIPLoad, JIPRMBG, JIPResize, JIPCNetPreprocess, JIPSave]

__all__ = ["NODES", "JIPLoad", "JIPRMBG", "JIPResize", "JIPCNetPreprocess", "JIPSave"]
