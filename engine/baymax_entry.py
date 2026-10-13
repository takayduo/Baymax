"""Single packaged entry point; the Electron parent selects the mode."""
import json
import multiprocessing
import sys


def main():
    multiprocessing.freeze_support()
    mode = sys.argv.pop(1) if len(sys.argv) > 1 else "--help"
    if mode == "bridge":
        from mochi_bridge import main as bridge_main
        bridge_main()
    elif mode == "live":
        from mochi_runner import run_mochi_ultra
        run_mochi_ultra()
    elif mode == "hud":
        import runpy
        runpy.run_module("main", run_name="__main__")
    elif mode == "python":
        import runpy
        arguments = sys.argv[1:]
        if not arguments:
            raise SystemExit("A script path or -m module is required")
        if arguments[0] == "-m":
            if len(arguments) < 2 or arguments[1] == "pip":
                raise SystemExit("Installing packages into the bundled runtime is unsupported. Use a separate Python installation for development projects.")
            sys.argv = arguments[1:]
            runpy.run_module(arguments[1], run_name="__main__", alter_sys=True)
        else:
            sys.argv = arguments
            runpy.run_path(arguments[0], run_name="__main__")
    elif mode == "--self-test":
        # Import and discover, without starting audio, an AI request or a PC action.
        from core.paths import resource_root, data_root
        from mochi_bridge import get_registry
        import mochi_runner
        from core.avatar import CATALOG, ACCESSORIES
        registry = get_registry()
        records = registry._all_records
        failures = [{"name": r.name, "error": r.error} for r in records if not r.valid]
        result = {"success": not failures, "actions": sorted(registry.names()),
                  "failures": failures, "prompt_exists": (resource_root() / "core" / "prompt.txt").is_file(),
                  "data_separate": data_root() != resource_root()}
        result["companions"] = len(CATALOG)
        result["accessories"] = len(ACCESSORIES)
        print(json.dumps(result))
        if failures or not result["prompt_exists"] or result["companions"] != 20:
            raise SystemExit(1)
    else:
        print("BaymaxEngine: bridge <command> | live | hud | --self-test")
        if mode != "--help":
            raise SystemExit(2)


if __name__ == "__main__":
    main()
