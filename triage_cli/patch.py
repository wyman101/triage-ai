"""
Patch application with safety checks.

Handles:
- Creating git branches before applying
- Validating patches apply cleanly
- Limiting scope of changes
"""

import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from .models.base import Patch


class PatchApplicator:
    """Apply patches with safety checks."""

    def __init__(self, max_files: int = 5, allowed_severities: set = None):
        """
        Initialize patch applicator.

        Args:
            max_files: Maximum files to modify per patch session
            allowed_severities: Only apply patches for these severities (default: S0, S1)
        """
        self.max_files = max_files
        self.allowed_severities = allowed_severities or {'S0', 'S1'}
        self.applied_files = set()

    def apply_patches(
        self,
        patches: list[Patch],
        create_branch: bool = True,
        branch_name: Optional[str] = None
    ) -> int:
        """
        Apply patches to the repository.

        Args:
            patches: List of patches to apply
            create_branch: Whether to create a new branch first
            branch_name: Name for the branch (default: triage/<timestamp>)

        Returns:
            Number of patches successfully applied
        """
        if not patches:
            return 0

        # Create branch if requested
        if create_branch:
            if not self._create_branch(branch_name):
                print("Warning: Failed to create branch, applying to current branch")

        applied = 0
        for patch in patches:
            # Check file limit
            if len(self.applied_files) >= self.max_files:
                print(f"Reached max file limit ({self.max_files}), stopping")
                break

            # Try to apply
            if self._apply_single_patch(patch):
                applied += 1
                self.applied_files.add(patch.path)

        return applied

    def _create_branch(self, branch_name: Optional[str] = None) -> bool:
        """Create a new git branch."""
        if not branch_name:
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            branch_name = f"triage/{timestamp}"

        try:
            result = subprocess.run(
                ['git', 'checkout', '-b', branch_name],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                print(f"Created branch: {branch_name}")
                return True
            else:
                print(f"Failed to create branch: {result.stderr}")
                return False
        except Exception as e:
            print(f"Error creating branch: {e}")
            return False

    def _apply_single_patch(self, patch: Patch) -> bool:
        """Apply a single patch."""
        # Validate patch format
        if not self._is_valid_patch(patch):
            print(f"Invalid patch format for {patch.path}")
            return False

        # Check if it applies cleanly (dry run)
        if not self._patch_applies_cleanly(patch):
            print(f"Patch does not apply cleanly to {patch.path}")
            return False

        # Actually apply
        return self._do_apply_patch(patch)

    def _is_valid_patch(self, patch: Patch) -> bool:
        """Validate patch is a valid unified diff."""
        if not patch.diff:
            return False

        # Check for unified diff markers
        lines = patch.diff.split('\n')
        has_minus = any(line.startswith('---') or line.startswith('-') for line in lines)
        has_plus = any(line.startswith('+++') or line.startswith('+') for line in lines)
        has_hunk = any(line.startswith('@@') for line in lines)

        return has_minus and has_plus

    def _patch_applies_cleanly(self, patch: Patch) -> bool:
        """Check if patch applies cleanly (dry run)."""
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.patch', delete=False) as f:
                f.write(patch.diff)
                patch_file = f.name

            result = subprocess.run(
                ['patch', '--dry-run', '-p1', '-i', patch_file],
                capture_output=True,
                text=True,
                timeout=10
            )

            import os
            os.unlink(patch_file)

            return result.returncode == 0

        except Exception as e:
            print(f"Error checking patch: {e}")
            return False

    def _do_apply_patch(self, patch: Patch) -> bool:
        """Actually apply the patch."""
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.patch', delete=False) as f:
                f.write(patch.diff)
                patch_file = f.name

            result = subprocess.run(
                ['patch', '-p1', '-i', patch_file],
                capture_output=True,
                text=True,
                timeout=10
            )

            import os
            os.unlink(patch_file)

            if result.returncode == 0:
                print(f"Applied patch to {patch.path}")
                return True
            else:
                print(f"Failed to apply patch: {result.stderr}")
                return False

        except Exception as e:
            print(f"Error applying patch: {e}")
            return False

    def show_patches(self, patches: list[Patch]) -> str:
        """Show patches without applying (dry run output)."""
        lines = []
        for i, patch in enumerate(patches, 1):
            lines.append(f"=== Patch {i}: {patch.path} ===")
            lines.append(f"Model: {patch.model}")
            lines.append(f"Description: {patch.description}")
            lines.append("")
            lines.append(patch.diff)
            lines.append("")

        return "\n".join(lines)
