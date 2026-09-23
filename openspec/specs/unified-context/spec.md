# unified-context Specification

## Purpose

The workspace assembles a bounded, traceable `ContextBundle` from existing authorities. Each source has one owner. Kairo MUST NOT duplicate transcripts, task stores, or memories that another authority already owns.

## Requirements

### Requirement: Single Owner Per Context Layer

The system MUST treat Pi as the owner of the active session and compaction, Engram as the owner of durable cross-session memory, CodeGraph as the owner of repository structure, Gentle AI as the owner of methodology, tasks, and gates, and Kairo as the owner of project and subscription intelligence.

#### Scenario: Bundle cites owners

- GIVEN the kernel builds a `ContextBundle` for a turn
- WHEN the bundle is produced
- THEN each included item MUST name its source authority
- AND the bundle MUST remain bounded by an explicit budget rather than concatenating full stores

#### Scenario: Duplicate stores forbidden

- GIVEN Pi already owns the interactive transcript
- WHEN Kairo handles conversation in the unified workspace
- THEN Kairo MUST NOT maintain a second transcript as the session authority
- AND Kairo MUST NOT maintain a second task store as the workflow authority

### Requirement: Bounded Traceable Bundle

A `ContextBundle` MUST be limited and traceable. Missing optional sources MUST omit their sections rather than invent content.

#### Scenario: Optional memory unavailable

- GIVEN Engram is not available
- WHEN the kernel builds a `ContextBundle`
- THEN the bundle MUST omit durable memory rather than inventing it
- AND the workspace MUST remain usable

#### Scenario: Compaction stays with Pi

- GIVEN the active session approaches its context limit
- WHEN compaction occurs
- THEN Pi MUST own compaction of the active session
- AND Kairo MUST NOT compact the Pi transcript as a competing authority

### Requirement: Resume Restores References

Resuming a session MUST restore context references that still exist. The system MUST NOT reconstruct missing Engram, CodeGraph, or Gentle AI state as if it were present.

#### Scenario: Resume with live references

- GIVEN a session whose bundle referenced Engram, CodeGraph, and workflow evidence that still exist
- WHEN the operator resumes that session
- THEN those references MUST be available to the restored workspace

#### Scenario: Resume with a missing source

- GIVEN a session whose bundle referenced a source that is now unavailable
- WHEN the operator resumes that session
- THEN the workspace MUST restore the Pi session
- AND the missing source MUST be reported as unavailable rather than filled with guessed content
