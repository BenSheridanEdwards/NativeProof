# Coding standards

Write code that is easy to understand, safe to change, and honest about what it guarantees. These standards apply across languages, frameworks, and repositories. Use the project's tools for mechanical conventions; use engineering judgement for the decisions below.

## 1. Prefer the simplest complete solution

Solve the actual requirement with the fewest moving parts that remain clear. Remove dead code and obsolete paths when they are part of the change. Build abstractions around a demonstrated shared responsibility, not a hypothetical future use. Consolidate duplicated knowledge; keep superficially similar code separate when it changes for different reasons.

## 2. Make the design readable

Use precise domain names and straightforward control flow. Keep responsibilities cohesive and interfaces small enough to understand without reading the whole implementation. Explain surprising constraints and decisions in comments, rather than narrating the code. Follow established project conventions unless changing them solves a concrete problem.

## 3. Separate decisions from effects

Where practical, keep business rules and transformations independent of files, networks, clocks, processes, and user interfaces. Place those effects at explicit boundaries. Pass dependencies and context deliberately so the core logic can be understood and tested without recreating the whole environment. Add a boundary when it reduces coupling or clarifies ownership, not merely to add another layer.

## 4. Make contracts and states explicit

Define what inputs mean, what outputs promise, and which failures callers must handle. Validate untrusted data at entry points. Use types or equivalent validation to make invalid states difficult to represent. Preserve meaningful distinctions such as absent, unreadable, unknown, and confirmed.

When changing a shared contract, trace the value from its producer through storage, transport, or parsing to affected consumers. A locally valid object is not proof that the complete system agrees.

## 5. Treat configuration as behaviour

Make defaults, overrides, and precedence understandable. Distinguish a fallback from a rule that must always hold. Consider creation, updates, explicit overrides, and missing or malformed configuration. Keep machine-specific assumptions out of portable logic. A constructed path or configured identifier does not prove that the resource exists or is usable.

## 6. Test observable behaviour

Test through the smallest meaningful public boundary. Derive expected results independently of the implementation being tested, and keep behaviour tests stable through internal refactoring. Match the fixture to the real failure mechanism and assert the result that matters to the caller. Cover relevant failure paths, not just the successful example.

Ask: **What plausible broken implementation could still pass this test?** Add the counterexample when it exposes a gap. Call counts do not prove ordering; injected values do not prove production supplies them. Use mocks for controlled boundaries, not to replace the behaviour being claimed. Keep tests deterministic and independent; reserve source-text assertions for genuine source-text contracts.

## 7. Own resources and failure paths

Make ownership and cleanup explicit for processes, streams, timers, subscriptions, and temporary files. Consider cancellation, timeout, partial completion, and ordinary exit. Report only the completion or cleanup that was actually observed. A request to stop is not proof of termination, and closing one resource is not proof that its dependants have stopped.

Preserve useful failure context. Recovery and retries must account for partial side effects rather than blindly repeating an operation.

## 8. Keep tests and tooling isolated

Use disposable resources and the minimum authority required. Treat inherited environment, resolved paths, and filesystem links as part of the safety boundary. A temporary-looking path alone does not establish isolation. Tests and development helpers must not mutate real credentials, user data, or host runtimes by accident.

## 9. Make changes easy to verify

Keep changes coherent and avoid unrelated churn. Include the tests and documentation needed to explain changed behaviour. Run the relevant existing checks and distinguish measured results from assumptions or untested cases. During review, separate standards findings from missing or incorrect required behaviour: well-structured code can still solve the wrong problem.

Automate fixed-pattern rules in the project's formatter, linter, type checker, or test suite. Reserve human and agent review for design, semantic correctness, missing evidence, and trade-offs. Keep detailed policies in one authoritative place rather than copying them into multiple instruction files.
