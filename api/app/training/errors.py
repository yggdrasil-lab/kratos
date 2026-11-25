"""Domain exceptions for the Kratos training core."""

from __future__ import annotations


class TrainingError(Exception):
    """Base domain error raised by the training core."""


class TrainingNotFoundError(TrainingError, LookupError):
    """Raised when a requested exercise, routine, item, plan, or session is missing."""


class TrainingConflictError(TrainingError):
    """Raised when a training mutation violates a uniqueness constraint."""


class InvalidSplitError(TrainingError, ValueError):
    """Raised when a session split request references missing routines or invalid state."""
