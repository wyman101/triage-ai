"""
Tests for merge/dedupe logic.
"""

import pytest
from triage_cli.models.base import Finding, Location, ModelResult
from triage_cli.merge import MergeEngine, FindingCluster


class TestFindingMatching:
    """Tests for Finding.matches() method."""

    def test_same_file_overlapping_lines_matches(self):
        """Findings with same file and overlapping lines should match."""
        f1 = Finding(
            title="SQL Injection",
            severity="S1",
            confidence="high",
            category="security",
            location=Location(path="user.py", start_line=10, end_line=15),
            evidence="query = f'SELECT * FROM users WHERE id={id}'",
            recommendation="Use parameterized queries"
        )
        f2 = Finding(
            title="SQL injection vulnerability",
            severity="S1",
            confidence="medium",
            category="security",
            location=Location(path="user.py", start_line=12, end_line=18),
            evidence="Unsafe string interpolation in SQL",
            recommendation="Use prepared statements"
        )

        assert f1.matches(f2)

    def test_different_files_no_match(self):
        """Findings in different files should not match by location."""
        f1 = Finding(
            title="SQL Injection",
            severity="S1",
            confidence="high",
            category="security",
            location=Location(path="user.py", start_line=10, end_line=15),
            evidence="...",
            recommendation="..."
        )
        f2 = Finding(
            title="Different issue",
            severity="S1",
            confidence="high",
            category="correctness",
            location=Location(path="admin.py", start_line=10, end_line=15),
            evidence="...",
            recommendation="..."
        )

        assert not f1.matches(f2)

    def test_same_category_similar_title_matches(self):
        """Findings with same category and similar titles should match."""
        f1 = Finding(
            title="Missing input validation in user registration",
            severity="S2",
            confidence="high",
            category="security",
            location=Location(path="api.py", start_line=100, end_line=110),
            evidence="...",
            recommendation="..."
        )
        f2 = Finding(
            title="Input validation missing in user registration endpoint",
            severity="S2",
            confidence="medium",
            category="security",
            location=Location(path="routes.py", start_line=50, end_line=60),
            evidence="...",
            recommendation="..."
        )

        assert f1.matches(f2)

    def test_different_category_different_title_no_match(self):
        """Findings with different category and title should not match."""
        f1 = Finding(
            title="SQL Injection vulnerability",
            severity="S1",
            confidence="high",
            category="security",
            location=Location(path="api.py", start_line=100, end_line=110),
            evidence="...",
            recommendation="..."
        )
        f2 = Finding(
            title="Slow database query",
            severity="S2",
            confidence="high",
            category="performance",
            location=Location(path="api.py", start_line=200, end_line=210),
            evidence="...",
            recommendation="..."
        )

        assert not f1.matches(f2)


class TestMergeEngine:
    """Tests for MergeEngine."""

    def test_empty_results(self):
        """Merging empty results should return empty merged result."""
        engine = MergeEngine()
        merged = engine.merge([])

        assert len(merged.blockers) == 0
        assert len(merged.high) == 0
        assert len(merged.medium) == 0
        assert len(merged.low) == 0
        assert len(merged.consensus) == 0

    def test_single_model_results(self):
        """Results from single model should have no consensus."""
        engine = MergeEngine()

        result = ModelResult(
            model="claude",
            summary="Found 2 issues",
            findings=[
                Finding(
                    title="Issue 1",
                    severity="S1",
                    confidence="high",
                    category="security",
                    location=Location(path="a.py", start_line=1, end_line=5),
                    evidence="...",
                    recommendation="..."
                ),
                Finding(
                    title="Issue 2",
                    severity="S2",
                    confidence="medium",
                    category="performance",
                    location=Location(path="b.py", start_line=10, end_line=20),
                    evidence="...",
                    recommendation="..."
                )
            ]
        )

        merged = engine.merge([result])

        assert len(merged.consensus) == 0
        assert len(merged.high) == 1
        assert len(merged.medium) == 1
        assert "claude" in merged.unique_by_model
        assert len(merged.unique_by_model["claude"]) == 2

    def test_consensus_detection(self):
        """Findings from 2+ models should be marked as consensus."""
        engine = MergeEngine()

        # Same issue found by both models
        claude_result = ModelResult(
            model="claude",
            summary="Found SQL injection",
            findings=[
                Finding(
                    title="SQL Injection in user.py",
                    severity="S0",
                    confidence="high",
                    category="security",
                    location=Location(path="user.py", start_line=10, end_line=15),
                    evidence="query = f'SELECT * FROM users WHERE id={id}'",
                    recommendation="Use parameterized queries"
                )
            ]
        )

        gemini_result = ModelResult(
            model="gemini",
            summary="Found SQL injection vulnerability",
            findings=[
                Finding(
                    title="SQL injection vulnerability in user.py",
                    severity="S0",
                    confidence="high",
                    category="security",
                    location=Location(path="user.py", start_line=10, end_line=15),
                    evidence="Unsafe SQL query construction",
                    recommendation="Use prepared statements"
                )
            ]
        )

        merged = engine.merge([claude_result, gemini_result])

        assert len(merged.consensus) == 1
        assert len(merged.blockers) == 1
        assert merged.blockers[0].is_consensus
        assert "claude" in merged.blockers[0].models
        assert "gemini" in merged.blockers[0].models

    def test_severity_grouping(self):
        """Findings should be grouped by severity."""
        engine = MergeEngine()

        result = ModelResult(
            model="codex",
            summary="Found multiple issues",
            findings=[
                Finding(
                    title="Blocker",
                    severity="S0",
                    confidence="high",
                    category="security",
                    location=Location(path="a.py", start_line=1, end_line=1),
                    evidence="...",
                    recommendation="..."
                ),
                Finding(
                    title="High",
                    severity="S1",
                    confidence="high",
                    category="correctness",
                    location=Location(path="b.py", start_line=1, end_line=1),
                    evidence="...",
                    recommendation="..."
                ),
                Finding(
                    title="Medium",
                    severity="S2",
                    confidence="medium",
                    category="performance",
                    location=Location(path="c.py", start_line=1, end_line=1),
                    evidence="...",
                    recommendation="..."
                ),
                Finding(
                    title="Low",
                    severity="S3",
                    confidence="low",
                    category="style",
                    location=Location(path="d.py", start_line=1, end_line=1),
                    evidence="...",
                    recommendation="..."
                )
            ]
        )

        merged = engine.merge([result])

        assert len(merged.blockers) == 1
        assert len(merged.high) == 1
        assert len(merged.medium) == 1
        assert len(merged.low) == 1


class TestFindingCluster:
    """Tests for FindingCluster."""

    def test_is_consensus(self):
        """Cluster with 2+ models should be consensus."""
        cluster = FindingCluster()

        # Add finding from first model
        f1 = Finding(
            title="Issue",
            severity="S1",
            confidence="high",
            category="security",
            location=Location(path="a.py", start_line=1, end_line=5),
            evidence="...",
            recommendation="...",
            model="claude"
        )
        cluster.add(f1)
        assert not cluster.is_consensus

        # Add finding from second model
        f2 = Finding(
            title="Issue",
            severity="S1",
            confidence="high",
            category="security",
            location=Location(path="a.py", start_line=1, end_line=5),
            evidence="...",
            recommendation="...",
            model="gemini"
        )
        cluster.add(f2)
        assert cluster.is_consensus

    def test_severity_returns_highest(self):
        """Cluster severity should be the highest among findings."""
        cluster = FindingCluster()

        cluster.add(Finding(
            title="Issue",
            severity="S2",
            confidence="high",
            category="security",
            location=Location(path="a.py", start_line=1, end_line=5),
            evidence="...",
            recommendation="...",
            model="claude"
        ))

        cluster.add(Finding(
            title="Issue",
            severity="S1",  # Higher severity
            confidence="high",
            category="security",
            location=Location(path="a.py", start_line=1, end_line=5),
            evidence="...",
            recommendation="...",
            model="gemini"
        ))

        assert cluster.severity == "S1"

    def test_representative_prefers_high_confidence(self):
        """Representative should be the highest confidence finding."""
        cluster = FindingCluster()

        f1 = Finding(
            title="Issue",
            severity="S1",
            confidence="low",
            category="security",
            location=Location(path="a.py", start_line=1, end_line=5),
            evidence="brief",
            recommendation="brief",
            model="claude"
        )
        cluster.add(f1)

        f2 = Finding(
            title="Issue",
            severity="S1",
            confidence="high",
            category="security",
            location=Location(path="a.py", start_line=1, end_line=5),
            evidence="detailed evidence here",
            recommendation="detailed recommendation",
            model="gemini"
        )
        cluster.add(f2)

        assert cluster.representative.confidence == "high"
        assert cluster.representative.model == "gemini"
