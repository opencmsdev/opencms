import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from "react-router";
import { api, type ContentTypeDef } from "./api.ts";
import { SessionProvider, useSession } from "./session.tsx";
import { Eyebrow } from "./ui.tsx";
import { Button } from "@/components/ui/button";
import { SetupScreen, SignInScreen } from "./screens/AuthScreens.tsx";
import { TypeEditorScreen, TypesScreen } from "./screens/TypesScreen.tsx";
import { EntriesScreen, EntryEditorScreen } from "./screens/EntriesScreen.tsx";
import { UsersScreen } from "./screens/UsersScreen.tsx";
import { KeysScreen } from "./screens/KeysScreen.tsx";
import { NotFoundScreen } from "./screens/NotFoundScreen.tsx";

/**
 * The version of the server this admin is talking to, read from /health rather
 * than baked in at build time. That distinction matters: the admin SPA can be
 * served from a different deploy than the API, and the number worth showing is
 * the one a bug report should quote, which is the server's.
 */
function ServerVersion() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(
      (h) => setVersion(h.version),
      // A version chip is not worth an error state; absent is fine.
      () => setVersion(null)
    );
  }, []);

  if (!version) return null;
  return (
    <span className="font-mono text-[10px] tracking-[0.08em] text-mute">v{version}</span>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-1.5 text-sm transition-colors ${
          isActive ? "bg-canvas-soft text-ink" : "text-body hover:bg-canvas-soft"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function Shell() {
  const { user, signOut } = useSession();
  const [types, setTypes] = useState<ContentTypeDef[]>([]);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api.listTypes().then((r) => setTypes(r.items), () => setTypes([]));
  }, []);

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-hairline flex flex-col">
        <div className="px-5 py-5 border-b border-hairline flex items-baseline gap-2">
          <Link to="/" className="text-ink text-lg tracking-[-0.02em]">
            OpenCMS
          </Link>
          <ServerVersion />
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-6">
          <div className="space-y-1">
            <div className="px-3 pb-1">
              <Eyebrow>Content</Eyebrow>
            </div>
            {types.map((t) => (
              <NavItem key={t.name} to={`/content/${t.name}`}>
                {t.label}
              </NavItem>
            ))}
            {types.length === 0 ? (
              <div className="px-3 text-xs text-mute">No content types yet.</div>
            ) : null}
          </div>
          {isAdmin ? (
            <div className="space-y-1">
              <div className="px-3 pb-1">
                <Eyebrow>Admin</Eyebrow>
              </div>
              <NavItem to="/types">Content types</NavItem>
              <NavItem to="/users">Users</NavItem>
              <NavItem to="/keys">API keys</NavItem>
            </div>
          ) : null}
        </nav>
        <div className="p-4 border-t border-hairline space-y-2">
          <div className="text-xs text-mute truncate">
            {user?.name} · <span className="font-mono">{user?.role}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void signOut()} data-testid="sign-out">
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-10">
          <Routes>
            <Route path="/" element={<Home types={types} isAdmin={isAdmin} />} />
            <Route path="/content/:type" element={<EntriesScreen />} />
            <Route path="/content/:type/new" element={<EntryEditorScreen />} />
            <Route path="/content/:type/:id" element={<EntryEditorScreen />} />
            {isAdmin ? (
              <>
                <Route path="/types" element={<TypesScreen />} />
                <Route path="/types/new" element={<TypeEditorScreen />} />
                <Route path="/types/:name" element={<TypeEditorScreen />} />
                <Route path="/users" element={<UsersScreen />} />
                <Route path="/keys" element={<KeysScreen />} />
              </>
            ) : null}
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function Home({ types, isAdmin }: { types: ContentTypeDef[]; isAdmin: boolean }) {
  if (types.length > 0) return <Navigate to={`/content/${types[0]!.name}`} replace />;
  return (
    <div className="space-y-4 pt-16 text-center">
      <Eyebrow>Welcome</Eyebrow>
      <h1 className="text-4xl text-ink tracking-[-0.04em]">Nothing here yet</h1>
      {isAdmin ? (
        <div className="pt-2">
          <Button asChild>
            <Link to="/types/new">Create the first content type</Link>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-mute">Ask an admin to create the first content type.</p>
      )}
    </div>
  );
}

function Gate() {
  const { loading, needsSetup, user } = useSession();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="eyebrow">Loading</span>
      </div>
    );
  }
  if (needsSetup) return <SetupScreen />;
  if (!user) return <SignInScreen />;
  return <Shell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </BrowserRouter>
  );
}
