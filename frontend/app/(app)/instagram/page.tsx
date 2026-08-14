"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Instagram, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, InlineError, LoadingRegion, Skeleton } from "@/components/ui/states";
import {
  useConnectInstagram,
  useDisconnectInstagram,
  useInstagramConnection,
} from "@/features/instagram/use-instagram";
import { errorMessage } from "@/lib/api";
import { absoluteTime } from "@/lib/utils";

/** Messages for the `reason` the OAuth callback redirects back with. */
const CALLBACK_MESSAGES: Record<string, string> = {
  invalid_state:
    "That authorization link had expired or had already been used. Start the connection again.",
  no_code: "Instagram did not return an authorization code. Please try again.",
  already_connected:
    "That Instagram account is already connected to a different workspace. Disconnect it there first.",
  exchange_failed:
    "Instagram accepted the authorization but the connection could not be completed. Please try again.",
  invalid_request: "That request was not valid. Start the connection again.",
};

/**
 * `useSearchParams` opts a component out of static prerendering unless it sits
 * inside a Suspense boundary — Next has to render the shell without knowing the
 * query string. The boundary is here rather than around the whole page so the
 * header and the connection card still prerender.
 */
export default function InstagramPage() {
  return (
    <React.Suspense fallback={<InstagramPageFallback />}>
      <InstagramPageContent />
    </React.Suspense>
  );
}

function InstagramPageFallback() {
  return (
    <>
      <PageHeader
        title="Instagram"
        description="The connected account is what delivers comments and messages to your workflows."
      />
      <LoadingRegion label="Loading Instagram connection">
        <Card>
          <div className="space-y-3 p-5">
            <Skeleton className="size-12 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        </Card>
      </LoadingRegion>
    </>
  );
}

function InstagramPageContent() {
  const searchParams = useSearchParams();
  const connection = useInstagramConnection();
  const connect = useConnectInstagram();
  const disconnect = useDisconnectInstagram();

  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);

  const status = searchParams.get("status");
  const reason = searchParams.get("reason");

  return (
    <>
      <PageHeader
        title="Instagram"
        description="The connected account is what delivers comments and messages to your workflows."
      />

      {status === "error" && (
        <div className="mb-5">
          <InlineError
            message={
              (reason && CALLBACK_MESSAGES[reason]) ??
              "The Instagram connection could not be completed. Please try again."
            }
          />
        </div>
      )}

      {status === "cancelled" && (
        <div className="mb-5 rounded-md border border-border bg-ink-50 px-3.5 py-3 text-[13px] text-ink-600">
          Authorization was cancelled. Nothing was connected.
        </div>
      )}

      {connection.isError ? (
        <Card>
          <ErrorState
            message={errorMessage(connection.error)}
            onRetry={() => void connection.refetch()}
          />
        </Card>
      ) : connection.isLoading || !connection.data ? (
        <LoadingRegion label="Loading Instagram connection">
          <Card>
            <div className="space-y-3 p-5">
              <Skeleton className="h-12 w-12 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          </Card>
        </LoadingRegion>
      ) : (
        <div className="space-y-5">
          {connection.data.isMockProvider && (
            <div className="flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden="true" />
              <div className="text-[13px] leading-5 text-warning-700">
                <strong className="font-semibold">Development mode.</strong> Instagram is being
                simulated locally — connecting will not touch a real account, and no messages are
                sent anywhere. Set <code className="font-mono text-[12px]">USE_MOCK_INSTAGRAM=false</code>{" "}
                with Meta credentials to use the real API.
              </div>
            </div>
          )}

          {/*
            "Connected" is rendered from `isConnected`, which the backend
            computes from the account row's status. It is never derived here
            from a truthy username — a disconnected or expired row would
            otherwise display as live.
          */}
          {connection.data.isConnected && connection.data.account ? (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4">
                <Avatar
                  url={connection.data.account.profilePictureUrl}
                  username={connection.data.account.username}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <p className="truncate text-[15px] font-semibold text-ink-900">
                      @{connection.data.account.username}
                    </p>
                    <Badge tone="success" dot>
                      Connected
                    </Badge>
                  </div>
                  {connection.data.account.displayName && (
                    <p className="mt-0.5 truncate text-[13px] text-ink-500">
                      {connection.data.account.displayName}
                    </p>
                  )}
                  <p className="mt-1 text-[12px] text-ink-400">
                    Connected{" "}
                    <time dateTime={connection.data.account.connectedAt}>
                      {absoluteTime(connection.data.account.connectedAt)}
                    </time>
                    {connection.data.account.tokenExpiresAt && (
                      <>
                        <span aria-hidden="true"> · </span>
                        access renews automatically
                      </>
                    )}
                  </p>
                </div>

                <Button variant="dangerSubtle" onClick={() => setConfirmDisconnect(true)}>
                  Disconnect
                </Button>
              </CardContent>
            </Card>
          ) : connection.data.account ? (
            <Card className="border-warning-200">
              <CardContent className="flex flex-wrap items-center gap-4">
                <Avatar
                  url={connection.data.account.profilePictureUrl}
                  username={connection.data.account.username}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <p className="truncate text-[15px] font-semibold text-ink-900">
                      @{connection.data.account.username}
                    </p>
                    <Badge tone="warning" dot>
                      {connection.data.reconnectReason === "REVOKED"
                        ? "Access revoked"
                        : connection.data.reconnectReason === "EXPIRED"
                          ? "Expired"
                          : "Disconnected"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-ink-500">
                    {connection.data.reconnectReason === "REVOKED"
                      ? "Access was revoked from Instagram's side. Reconnect to resume automation."
                      : connection.data.reconnectReason === "EXPIRED"
                        ? "The access token expired. Reconnect to resume automation."
                        : "This account was disconnected. Reconnect it to resume automation."}
                  </p>
                </div>
                <Button loading={connect.isPending} onClick={() => connect.mutate()}>
                  Reconnect
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={Instagram}
                title="Connect your Instagram account"
                description="SocialPilot needs a connected Instagram professional account to receive comments and messages, and to reply on your behalf. You can disconnect at any time."
                action={
                  <Button loading={connect.isPending} onClick={() => connect.mutate()}>
                    Connect Instagram
                  </Button>
                }
              />
            </Card>
          )}

          {connect.isError && <InlineError message={errorMessage(connect.error)} />}

          <Card>
            <CardHeader>
              <CardTitle>What SocialPilot can do</CardTitle>
            </CardHeader>
            <CardContent>
              {/*
                Stated plainly, and it matches the scopes actually requested.
                Asking for a permission the product does not exercise is both a
                trust problem and a guaranteed App Review rejection.
              */}
              <ul className="space-y-2.5 text-[13px] leading-6 text-ink-600">
                <Permission>Read your profile and recent posts, to identify the account and let you target specific posts.</Permission>
                <Permission>Read and reply to comments on your posts.</Permission>
                <Permission>Read and send direct messages.</Permission>
              </ul>
              <p className="mt-4 text-[12.5px] leading-5 text-ink-400">
                SocialPilot cannot post to your feed, change your profile, or see your password.
                Access tokens are encrypted before they are stored and are never shown in the app.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Instagram?"
        description="Active workflows will stop receiving events immediately. Your workflows and run history are kept."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDisconnect(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={disconnect.isPending}
            onClick={() => {
              const accountId = connection.data?.account?.id;
              if (accountId) {
                disconnect.mutate(accountId, { onSuccess: () => setConfirmDisconnect(false) });
              }
            }}
          >
            Disconnect
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function Permission({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-300" />
      <span>{children}</span>
    </li>
  );
}

function Avatar({ url, username }: { url: string | null; username: string }) {
  if (url) {
    // A plain img rather than next/image: this is one small avatar from a CDN
    // that already serves an appropriate size, and routing it through the
    // optimizer would add a server round trip for no benefit.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={48}
        height={48}
        className="size-12 shrink-0 rounded-full border border-border object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[16px] font-semibold text-white"
    >
      {username.charAt(0).toUpperCase()}
    </span>
  );
}
