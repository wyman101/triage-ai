"""
Merge and deduplicate findings from multiple models.

Handles:
- Clustering similar findings
- Identifying consensus (2+ models agree)
- Detecting conflicts/disagreements
- Aggregating patches
"""

from dataclasses import dataclass, field
from typing import Optional
from collections import defaultdict

from .models.base import ModelResult, Finding, Patch, Location


@dataclass
class FindingCluster:
    """A cluster of similar findings from multiple models."""
    findings: list[Finding] = field(default_factory=list)
    models: set = field(default_factory=set)

    @property
    def is_consensus(self) -> bool:
        """True if 2+ models agree on this issue."""
        return len(self.models) >= 2

    @property
    def representative(self) -> Finding:
        """Return the most detailed/highest confidence finding."""
        if not self.findings:
            raise ValueError("Empty cluster")

        # Prefer high confidence, then by evidence length
        return max(
            self.findings,
            key=lambda f: (
                f.confidence == 'high',
                f.confidence == 'medium',
                len(f.evidence or ''),
                len(f.recommendation or '')
            )
        )

    @property
    def severity(self) -> str:
        """Return the highest severity in the cluster."""
        severity_order = ['S0', 'S1', 'S2', 'S3']
        for sev in severity_order:
            if any(f.severity == sev for f in self.findings):
                return sev
        return 'S3'

    @property
    def all_patches(self) -> list[Patch]:
        """Return all patches from this cluster."""
        patches = []
        for f in self.findings:
            if f.patch:
                patches.append(Patch(
                    path=f.location.path,
                    diff=f.patch,
                    description=f.title,
                    model=f.model
                ))
        return patches

    def add(self, finding: Finding):
        """Add a finding to this cluster."""
        self.findings.append(finding)
        self.models.add(finding.model)


@dataclass
class Conflict:
    """Disagreement between models on severity or whether something is an issue."""
    title: str
    findings: list[Finding]
    conflict_type: str  # 'severity' or 'existence'
    details: str


@dataclass
class MergedResult:
    """Result of merging multiple model outputs."""
    # Findings by severity
    blockers: list[FindingCluster] = field(default_factory=list)  # S0
    high: list[FindingCluster] = field(default_factory=list)      # S1
    medium: list[FindingCluster] = field(default_factory=list)    # S2
    low: list[FindingCluster] = field(default_factory=list)       # S3

    # Consensus vs unique
    consensus: list[FindingCluster] = field(default_factory=list)
    unique_by_model: dict = field(default_factory=dict)  # model -> list[Finding]

    # Conflicts
    conflicts: list[Conflict] = field(default_factory=list)

    # Aggregated patches
    patches: list[Patch] = field(default_factory=list)

    # Questions from models
    questions: list[str] = field(default_factory=list)

    # Model summaries
    summaries: dict = field(default_factory=dict)  # model -> summary

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        def cluster_to_dict(c: FindingCluster) -> dict:
            return {
                'is_consensus': c.is_consensus,
                'models': list(c.models),
                'severity': c.severity,
                'representative': c.representative.to_dict(),
                'all_findings': [f.to_dict() for f in c.findings],
                'patches': [p.to_dict() for p in c.all_patches]
            }

        return {
            'blockers': [cluster_to_dict(c) for c in self.blockers],
            'high': [cluster_to_dict(c) for c in self.high],
            'medium': [cluster_to_dict(c) for c in self.medium],
            'low': [cluster_to_dict(c) for c in self.low],
            'consensus': [cluster_to_dict(c) for c in self.consensus],
            'unique_by_model': {
                model: [f.to_dict() for f in findings]
                for model, findings in self.unique_by_model.items()
            },
            'conflicts': [
                {'title': c.title, 'type': c.conflict_type, 'details': c.details,
                 'findings': [f.to_dict() for f in c.findings]}
                for c in self.conflicts
            ],
            'patches': [p.to_dict() for p in self.patches],
            'questions': self.questions,
            'summaries': self.summaries,
        }


class MergeEngine:
    """Engine for merging findings from multiple models."""

    def __init__(self, similarity_threshold: float = 0.6):
        """
        Initialize merge engine.

        Args:
            similarity_threshold: Minimum similarity for clustering (0-1)
        """
        self.similarity_threshold = similarity_threshold

    def merge(self, results: list[ModelResult]) -> MergedResult:
        """
        Merge results from multiple models.

        Args:
            results: List of ModelResult from different models

        Returns:
            MergedResult with clustered and categorized findings
        """
        merged = MergedResult()

        # Collect all findings
        all_findings = []
        for result in results:
            merged.summaries[result.model] = result.summary
            merged.questions.extend(result.questions)

            for finding in result.findings:
                finding.model = result.model
                all_findings.append(finding)

        # Cluster similar findings
        clusters = self._cluster_findings(all_findings)

        # Categorize by severity and consensus
        for cluster in clusters:
            severity = cluster.severity

            if severity == 'S0':
                merged.blockers.append(cluster)
            elif severity == 'S1':
                merged.high.append(cluster)
            elif severity == 'S2':
                merged.medium.append(cluster)
            else:
                merged.low.append(cluster)

            if cluster.is_consensus:
                merged.consensus.append(cluster)
            else:
                # Single model finding
                model = list(cluster.models)[0]
                if model not in merged.unique_by_model:
                    merged.unique_by_model[model] = []
                merged.unique_by_model[model].extend(cluster.findings)

        # Detect conflicts
        merged.conflicts = self._detect_conflicts(clusters)

        # Aggregate patches
        merged.patches = self._aggregate_patches(clusters)

        # Sort by severity within categories
        merged.blockers.sort(key=lambda c: len(c.models), reverse=True)
        merged.high.sort(key=lambda c: len(c.models), reverse=True)
        merged.medium.sort(key=lambda c: len(c.models), reverse=True)
        merged.low.sort(key=lambda c: len(c.models), reverse=True)

        return merged

    def _cluster_findings(self, findings: list[Finding]) -> list[FindingCluster]:
        """Cluster similar findings together."""
        clusters = []

        for finding in findings:
            # Try to add to existing cluster
            added = False
            for cluster in clusters:
                if self._should_cluster(finding, cluster):
                    cluster.add(finding)
                    added = True
                    break

            # Create new cluster if no match
            if not added:
                cluster = FindingCluster()
                cluster.add(finding)
                clusters.append(cluster)

        return clusters

    def _should_cluster(self, finding: Finding, cluster: FindingCluster) -> bool:
        """Check if a finding should be added to a cluster."""
        for existing in cluster.findings:
            if finding.matches(existing, self.similarity_threshold):
                return True
        return False

    def _detect_conflicts(self, clusters: list[FindingCluster]) -> list[Conflict]:
        """Detect disagreements between models."""
        conflicts = []

        for cluster in clusters:
            if len(cluster.findings) < 2:
                continue

            # Check for severity disagreements
            severities = set(f.severity for f in cluster.findings)
            if len(severities) > 1:
                # Significant disagreement (more than 1 level apart)
                sev_values = {'S0': 0, 'S1': 1, 'S2': 2, 'S3': 3}
                sev_nums = [sev_values[s] for s in severities]
                if max(sev_nums) - min(sev_nums) >= 2:
                    conflicts.append(Conflict(
                        title=cluster.representative.title,
                        findings=cluster.findings,
                        conflict_type='severity',
                        details=f"Models disagree on severity: {severities}"
                    ))

        return conflicts

    def _aggregate_patches(self, clusters: list[FindingCluster]) -> list[Patch]:
        """Aggregate unique patches from all clusters."""
        patches = []
        seen = set()

        # Prioritize consensus patches
        for cluster in sorted(clusters, key=lambda c: len(c.models), reverse=True):
            for patch in cluster.all_patches:
                # Dedupe by path + first 100 chars of diff
                key = (patch.path, patch.diff[:100])
                if key not in seen:
                    seen.add(key)
                    patches.append(patch)

        return patches
