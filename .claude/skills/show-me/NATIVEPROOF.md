# NativeProof show-me guidance

Read this file with `SKILL.md`. These repository rules override the upstream HTML instruction.

- Use a view for a substantive pull request when it removes review ambiguity. Do not add a visual to a trivial pull request.
- Choose the smallest useful view, such as a focused diff, call tree, file tree, pseudocode, or Mermaid diagram.
- Verify every label, path, symbol, relationship, and sequence against the current source. Put source paths or symbols beside the view when they help a reviewer check it.
- A view explains evidence. It never replaces tests, screenshots, reports, source links, warnings, or explicit uncertainty.
- Use HTML only when a text view or Mermaid cannot make the point clearly and HTML is permitted for the task. Write it under `.e2e-artifacts/show-me/<task-slug>/` so it stays local and ignored.
- Do not automatically open, publish, or commit HTML. Do not run the upstream `open` command unless the user explicitly asks to open the artifact.
