# Device proof: nativeproof inspect (issue #23, step 2)

`android-settings-inspect.log` is the verbatim output of `nativeproof inspect --android`
run 2026-07-02 against a live Android 15 emulator showing the Settings home screen:
41 candidate locators — semantic roles with accessible names first, then every visible
text, then resource-id test ids — with no page-source XML in sight.
