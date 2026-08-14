"use client"

import React, { useMemo } from "react"
import { useDashboard } from "@/hooks/useDashboard"
import {
  Activity,
  Users,
  DollarSign,
  Layers,
  Bell,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Wifi,
  WifiOff,
  Database,
  TrendingUp,
  Clock,
} from "lucide-react"

// ── Helper components ──────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  delay,
  loading,
  subtitle,
}: {
  title: string
  value: string | number
  icon: React.ElementType
  color: string
  delay: number
  loading?: boolean
  subtitle?: string
}) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-4 animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        {loading && (
          <div className="h-4 w-16 bg-gray-200 rounded animate-skeleton-pulse" />
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900">
        {loading ? (
          <span className="inline-block h-8 w-20 bg-gray-200 rounded animate-skeleton-pulse" />
        ) : (
          value
        )}
      </div>
      <div className="text-sm text-gray-500 mt-1">{title}</div>
      {subtitle && (
        <div className="text-xs text-gray-400 mt-1">{subtitle}</div>
      )}
    </div>
  )
}

function ConnectionBadge({ status }: { status: string }) {
  const config = {
    connected: { icon: Wifi, color: "text-green-600", bg: "bg-green-100", label: "Live" },
    connecting: { icon: RefreshCw, color: "text-yellow-600", bg: "bg-yellow-100", label: "Connecting" },
    disconnected: { icon: WifiOff, color: "text-gray-600", bg: "bg-gray-100", label: "Offline" },
    error: { icon: AlertTriangle, color: "text-red-600", bg: "bg-red-100", label: "Error" },
  }[status] || { icon: WifiOff, color: "text-gray-600", bg: "bg-gray-100", label: "Unknown" }

  const Icon = config.icon

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
      <Icon className={`h-3.5 w-3.5 ${status === "connecting" ? "animate-spin-slow" : ""}`} />
      {config.label}
    </div>
  )
}

function PaymentStatusRow({ payment }: { payment: any }) {
  const isSuccess = payment.status === "confirmed"
  const isFailed = payment.status === "failed"
  const isPending = payment.status === "pending"

  return (
    <div className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 rounded-md transition-colors duration-150">
      <div className="flex items-center gap-3 min-w-0">
        {isSuccess && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
        {isFailed && <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
        {isPending && <Clock className="h-4 w-4 text-yellow-500 shrink-0" />}
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">
            {payment.streamId || "Unknown Stream"}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {payment.sender?.slice(0, 8)}... → {payment.receiver?.slice(0, 8)}...
          </div>
        </div>
      </div>
      <div className="text-right shrink-0 ml-4">
        <div className="text-sm font-medium text-gray-900">
          {payment.amount} {payment.asset}
        </div>
        <div className={`text-xs ${isSuccess ? "text-green-600" : isFailed ? "text-red-600" : "text-yellow-600"}`}>
          {isSuccess ? "Confirmed" : isFailed ? "Failed" : "Pending"}
        </div>
      </div>
    </div>
  )
}

function ProgressBar({ percentage }: { percentage: number }) {
  const color =
    percentage >= 100 ? "bg-green-500"
      : percentage >= 75 ? "bg-blue-500"
        : percentage >= 50 ? "bg-yellow-500"
          : "bg-gray-400"

  return (
    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-1000 ease-out ${color}`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  )
}

function StreamProgressCard({ progress }: { progress: any }) {
  return (
    <div className="py-2 px-3 hover:bg-gray-50 rounded-md transition-colors duration-150">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium text-gray-900 truncate">
          {progress.streamId || "Unknown Stream"}
        </div>
        <div className="text-sm font-semibold text-gray-900 shrink-0 ml-2">
          {progress.percentage}%
        </div>
      </div>
      <ProgressBar percentage={progress.percentage} />
      <div className="flex items-center justify-between mt-1">
        <div className="text-xs text-gray-500">
          {progress.streamedAmount} / {progress.totalAmount}
        </div>
        <div className="text-xs text-gray-400">
          ~{Math.max(0, 100 - progress.percentage)}% remaining
        </div>
      </div>
    </div>
  )
}

function NotificationItem({ notification, onMarkRead }: { notification: any; onMarkRead: (id: string) => void }) {
  const severityStyles: Record<string, string> = {
    info: "border-l-blue-500 bg-blue-50",
    warning: "border-l-yellow-500 bg-yellow-50",
    error: "border-l-red-500 bg-red-50",
    success: "border-l-green-500 bg-green-50",
  }

  return (
    <div
      className={`border-l-4 ${severityStyles[notification.severity] || severityStyles.info} px-3 py-2 rounded-r-md mb-2 cursor-pointer transition-opacity duration-150 ${notification.read ? "opacity-60" : ""}`}
      onClick={() => onMarkRead(notification.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">{notification.title}</div>
          <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{notification.message}</div>
        </div>
        <div className="text-xs text-gray-400 shrink-0">
          {new Date(notification.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard Component ────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    stats,
    payments,
    notifications,
    streamProgress,
    activeUsers,
    connectionStatus,
    loading,
    error,
    isPolling,
    clearNotifications,
    markNotificationRead,
    refresh,
    reconnect,
  } = useDashboard({
    pollingInterval: 30000,
  })

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  )

  const recentPayments = useMemo(() => payments.slice(0, 10), [payments])
  const recentNotifications = useMemo(() => notifications.slice(0, 10), [notifications])
  const activeProgresses = useMemo(
    () => streamProgress.filter((sp) => sp.percentage < 100).slice(0, 10),
    [streamProgress]
  )

  return (
    <div className="min-h-screen bg-gray-50 animate-fade-in">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Dashboard
              </h1>
              <p className="text-gray-600">
                Real-time overview of your StellarStream activity and protocol statistics.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <ConnectionBadge status={connectionStatus} />
              {isPolling && (
                <div className="flex items-center gap-1.5 text-xs text-yellow-600 bg-yellow-50 px-3 py-1.5 rounded-full">
                  <Database className="h-3.5 w-3.5" />
                  Polling
                </div>
              )}
              <button
                onClick={refresh}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 active:scale-95 transition-all duration-150 disabled:opacity-50"
                aria-label="Refresh dashboard"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin-slow" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800 animate-shake">
            <AlertTriangle className="h-5 w-5" />
            <span>{error}</span>
            <button
              onClick={reconnect}
              className="ml-auto text-sm underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Active Users"
            value={activeUsers || stats.activeUsers}
            icon={Users}
            color="bg-blue-500"
            delay={0}
            loading={loading}
          />
          <StatCard
            title="Total Streams"
            value={stats.totalStreams}
            icon={Layers}
            color="bg-purple-500"
            delay={100}
            loading={loading}
          />
          <StatCard
            title="Active Streams"
            value={stats.activeStreams}
            icon={Activity}
            color="bg-green-500"
            delay={200}
            loading={loading}
          />
          <StatCard
            title="Total Volume"
            value={stats.totalVolume !== "0" ? `${(Number(stats.totalVolume) / 10_000_000).toString()} XLM` : "0 XLM"}
            icon={DollarSign}
            color="bg-amber-500"
            delay={300}
            loading={loading}
            subtitle="In active streams"
          />
        </div>

        {/* Connection Status Card (when offline) */}
        {connectionStatus !== "connected" && connectionStatus !== "connecting" && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg animate-fade-in-up">
            <div className="flex items-center gap-3">
              <WifiOff className="h-5 w-5 text-yellow-600" />
              <div>
                <div className="text-sm font-medium text-yellow-800">
                  Real-time connection lost
                </div>
                <div className="text-sm text-yellow-700">
                  Data is being updated via polling. Updates may be delayed.
                </div>
              </div>
              <button
                onClick={reconnect}
                className="ml-auto px-3 py-1.5 text-sm bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors"
              >
                Reconnect
              </button>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Payment Status Feed */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-gray-600" />
                  <h2 className="text-lg font-semibold text-gray-900">
                    Payment Status
                  </h2>
                </div>
                <span className="text-xs text-gray-500">
                  {payments.length} total
                </span>
              </div>
            </div>
            <div className="p-2">
              {loading && payments.length === 0 ? (
                <div className="space-y-2 p-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="inline-block h-4 w-4 bg-gray-200 rounded-full animate-skeleton-pulse" />
                      <div className="flex-1">
                        <span className="inline-block h-4 w-48 bg-gray-200 rounded animate-skeleton-pulse" />
                        <span className="inline-block h-3 w-32 bg-gray-200 rounded mt-1 animate-skeleton-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentPayments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">📭</div>
                  <div className="text-sm">No payment activity yet</div>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {recentPayments.map((payment, idx) => (
                    <div
                      key={`${payment.streamId}-${idx}`}
                      className="animate-fade-in"
                      style={{ animationDelay: `${idx * 30}ms` }}
                    >
                      <PaymentStatusRow payment={payment} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Notifications + Stream Progress */}
          <div className="space-y-6">
            {/* Notification Feed */}
            <div className="bg-white rounded-lg border border-gray-200 animate-fade-in-up" style={{ animationDelay: '500ms' }}>
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-gray-600" />
                    <h2 className="text-lg font-semibold text-gray-900">
                      Notifications
                    </h2>
                    {unreadCount > 0 && (
                      <span className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1.5 text-xs font-bold text-white bg-red-500 rounded-full">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  {notifications.length > 0 && (
                    <button
                      onClick={clearNotifications}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
              <div className="p-2 max-h-[320px] overflow-y-auto">
                {loading && notifications.length === 0 ? (
                  <div className="space-y-2 p-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="border-l-4 border-gray-200 bg-gray-50 px-3 py-2 rounded-r-md">
                        <span className="inline-block h-4 w-32 bg-gray-200 rounded animate-skeleton-pulse" />
                        <span className="inline-block h-3 w-48 bg-gray-200 rounded mt-1 animate-skeleton-pulse" />
                      </div>
                    ))}
                  </div>
                ) : recentNotifications.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">🔔</div>
                    <div className="text-sm">No notifications yet</div>
                  </div>
                ) : (
                  <div>
                    {recentNotifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onMarkRead={markNotificationRead}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Stream Progress */}
            <div className="bg-white rounded-lg border border-gray-200 animate-fade-in-up" style={{ animationDelay: '600ms' }}>
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-gray-600" />
                  <h2 className="text-lg font-semibold text-gray-900">
                    Stream Progress
                  </h2>
                </div>
              </div>
              <div className="p-2 max-h-[280px] overflow-y-auto">
                {loading && activeProgresses.length === 0 ? (
                  <div className="space-y-3 p-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i}>
                        <span className="inline-block h-4 w-32 bg-gray-200 rounded animate-skeleton-pulse" />
                        <span className="inline-block h-2 w-full bg-gray-200 rounded mt-1 animate-skeleton-pulse" />
                      </div>
                    ))}
                  </div>
                ) : activeProgresses.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">📊</div>
                    <div className="text-sm">No active streams in progress</div>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {activeProgresses.map((progress) => (
                      <StreamProgressCard
                        key={progress.streamId}
                        progress={progress}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-8 p-4 bg-gray-100 rounded-lg animate-fade-in-up" style={{ animationDelay: '700ms' }}>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Database className="h-4 w-4" />
            {isPolling ? (
              <span>Data is being polled every 30 seconds. {connectionStatus === "disconnected" && "WebSocket is disconnected."}</span>
            ) : (
              <span>Receiving real-time updates via WebSocket. Updates appear within 1 second.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

