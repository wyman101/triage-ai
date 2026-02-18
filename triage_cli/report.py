"""
Report generation in Markdown and JSON formats.
"""

import json
from datetime import datetime
from typing import Optional

from .merge import MergedResult, FindingCluster


class ReportGenerator:
    """Generate reports from merged results."""

    def to_markdown(
        self,
        merged: MergedResult,
        prompt: str,
        context: dict,
        elapsed: float
    ) -> str:
        """Generate Markdown report."""
        lines = []

        # Header
        lines.append("# Code Triage Report")
        lines.append("")
        lines.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(f"**Duration:** {elapsed:.1f}s")
        lines.append(f"**Models:** {', '.join(merged.summaries.keys())}")
        lines.append("")

        # Prompt
        lines.append("## Request")
        lines.append("")
        lines.append(f"> {prompt}")
        lines.append("")

        # Summary
        lines.append("## Summary")
        lines.append("")
        total = (len(merged.blockers) + len(merged.high) +
                 len(merged.medium) + len(merged.low))
        consensus_count = len(merged.consensus)
        lines.append(f"- **Total Issues:** {total}")
        lines.append(f"- **Consensus (2+ models):** {consensus_count}")
        lines.append(f"- **Blockers (S0):** {len(merged.blockers)}")
        lines.append(f"- **High (S1):** {len(merged.high)}")
        lines.append(f"- **Medium (S2):** {len(merged.medium)}")
        lines.append(f"- **Low (S3):** {len(merged.low)}")
        lines.append("")

        # Model summaries
        lines.append("### Model Assessments")
        lines.append("")
        for model, summary in merged.summaries.items():
            lines.append(f"**{model.upper()}:** {summary}")
            lines.append("")

        # Blockers
        if merged.blockers:
            lines.append("## Blockers (S0)")
            lines.append("")
            for i, cluster in enumerate(merged.blockers, 1):
                lines.extend(self._render_cluster(cluster, i))

        # High
        if merged.high:
            lines.append("## High Priority (S1)")
            lines.append("")
            for i, cluster in enumerate(merged.high, 1):
                lines.extend(self._render_cluster(cluster, i))

        # Medium
        if merged.medium:
            lines.append("## Medium Priority (S2)")
            lines.append("")
            for i, cluster in enumerate(merged.medium, 1):
                lines.extend(self._render_cluster(cluster, i))

        # Low
        if merged.low:
            lines.append("## Low Priority (S3)")
            lines.append("")
            for i, cluster in enumerate(merged.low, 1):
                lines.extend(self._render_cluster(cluster, i))

        # Consensus findings
        if merged.consensus:
            lines.append("## Consensus Findings")
            lines.append("")
            lines.append("*Issues identified by 2+ models:*")
            lines.append("")
            for cluster in merged.consensus:
                f = cluster.representative
                models = ', '.join(sorted(cluster.models))
                lines.append(f"- [{f.severity}] **{f.title}** ({f.location.path}) - *{models}*")
            lines.append("")

        # Unique findings by model
        if merged.unique_by_model:
            lines.append("## Unique Findings by Model")
            lines.append("")
            for model, findings in sorted(merged.unique_by_model.items()):
                if findings:
                    lines.append(f"### {model.upper()} only ({len(findings)})")
                    lines.append("")
                    for f in findings:
                        lines.append(f"- [{f.severity}] {f.title} ({f.location.path})")
                    lines.append("")

        # Conflicts
        if merged.conflicts:
            lines.append("## Conflicts / Disagreements")
            lines.append("")
            for conflict in merged.conflicts:
                lines.append(f"### {conflict.title}")
                lines.append(f"*Type: {conflict.conflict_type}*")
                lines.append("")
                lines.append(conflict.details)
                lines.append("")

        # Patches
        if merged.patches:
            lines.append("## Proposed Patches")
            lines.append("")
            for i, patch in enumerate(merged.patches, 1):
                lines.append(f"### Patch {i}: {patch.description} ({patch.model})")
                lines.append(f"*File: {patch.path}*")
                lines.append("")
                lines.append("```diff")
                lines.append(patch.diff)
                lines.append("```")
                lines.append("")

        # Questions
        if merged.questions:
            lines.append("## Open Questions")
            lines.append("")
            for q in merged.questions:
                lines.append(f"- {q}")
            lines.append("")

        # Recommended plan
        lines.append("## Recommended Plan")
        lines.append("")
        plan_items = []

        # Add blockers first
        for cluster in merged.blockers:
            f = cluster.representative
            tag = " (consensus)" if cluster.is_consensus else ""
            plan_items.append(f"1. **[BLOCKER]** {f.title} - {f.location.path}{tag}")

        # Then high priority consensus
        for cluster in merged.high:
            if cluster.is_consensus:
                f = cluster.representative
                plan_items.append(f"2. **[HIGH]** {f.title} - {f.location.path} (consensus)")

        # Then remaining high
        for cluster in merged.high:
            if not cluster.is_consensus:
                f = cluster.representative
                plan_items.append(f"3. **[HIGH]** {f.title} - {f.location.path}")

        if plan_items:
            lines.extend(plan_items[:10])  # Top 10 actions
        else:
            lines.append("No critical issues found. Consider reviewing medium/low findings.")

        lines.append("")
        lines.append("---")
        lines.append(f"*Report generated by triage-cli v1.0.0*")

        return "\n".join(lines)

    def _render_cluster(self, cluster: FindingCluster, index: int) -> list[str]:
        """Render a finding cluster."""
        lines = []
        f = cluster.representative

        # Header with consensus indicator
        consensus = " [CONSENSUS]" if cluster.is_consensus else ""
        models = ', '.join(sorted(cluster.models))
        lines.append(f"### {index}. {f.title}{consensus}")
        lines.append("")
        lines.append(f"- **Severity:** {f.severity}")
        lines.append(f"- **Confidence:** {f.confidence}")
        lines.append(f"- **Category:** {f.category}")
        lines.append(f"- **Location:** `{f.location.path}:{f.location.start_line}-{f.location.end_line}`")
        lines.append(f"- **Models:** {models}")
        lines.append("")

        if f.evidence:
            lines.append("**Evidence:**")
            lines.append("```")
            lines.append(f.evidence[:500])
            lines.append("```")
            lines.append("")

        if f.recommendation:
            lines.append(f"**Recommendation:** {f.recommendation}")
            lines.append("")

        # Show patches if any
        patches = cluster.all_patches
        if patches:
            lines.append("**Proposed fix:**")
            lines.append("```diff")
            lines.append(patches[0].diff[:1000])
            lines.append("```")
            lines.append("")

        return lines

    def to_json(
        self,
        merged: MergedResult,
        prompt: str,
        context: dict,
        elapsed: float
    ) -> str:
        """Generate JSON report."""
        report = {
            'metadata': {
                'generated': datetime.now().isoformat(),
                'duration_seconds': elapsed,
                'prompt': prompt,
                'models': list(merged.summaries.keys()),
            },
            'summary': {
                'total_issues': (len(merged.blockers) + len(merged.high) +
                                 len(merged.medium) + len(merged.low)),
                'consensus_count': len(merged.consensus),
                'blockers': len(merged.blockers),
                'high': len(merged.high),
                'medium': len(merged.medium),
                'low': len(merged.low),
            },
            'results': merged.to_dict(),
        }
        return json.dumps(report, indent=2)
