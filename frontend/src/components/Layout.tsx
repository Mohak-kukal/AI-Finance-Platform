import React from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { 
  Home, 
  CreditCard, 
  Receipt, 
  Target, 
  TrendingUp, 
  LogOut,
  User
} from 'lucide-react'
import { useUser, useClerk } from '@clerk/clerk-react'
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarNavItem,
} from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ThemeToggle } from '@/components/ThemeToggle'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Accounts', href: '/dashboard/accounts', icon: CreditCard },
  { name: 'Transactions', href: '/dashboard/transactions', icon: Receipt },
  { name: 'Budgets', href: '/dashboard/budgets', icon: Target },
  { name: 'Insights', href: '/dashboard/insights', icon: TrendingUp },
]

export function Layout() {
  const location = useLocation()
  const { user } = useUser()
  const { signOut } = useClerk()

  const userInitials = user?.fullName 
    ? user.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.firstName?.[0]?.toUpperCase() || 'U'

  return (
    <div className="min-h-screen bg-background">
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="ml-3 text-xl font-semibold text-foreground">
              AI Finance
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <nav className="space-y-2">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href
              return (
                <SidebarNavItem
                  key={item.name}
                  asChild
                  active={isActive}
                >
                  <Link to={item.href}>
                    <item.icon className="h-5 w-5 mr-3" />
                    {item.name}
                  </Link>
                </SidebarNavItem>
              )
            })}
          </nav>
        </SidebarContent>

        <SidebarFooter>
          <div className="flex items-center mb-3">
            <Avatar>
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
            <div className="ml-3 flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {user?.fullName || user?.firstName || 'User'}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.primaryEmailAddress?.emailAddress || ''}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                // Clear user-specific sessionStorage data before signing out
                sessionStorage.removeItem('insights_advice')
                sessionStorage.removeItem('insights_predictions')
                sessionStorage.removeItem('insights_prediction_month')
                sessionStorage.removeItem('insights_prediction_year')
                sessionStorage.removeItem('insights_user_id')
                signOut()
              }}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* Main content */}
      <div className="pl-64">
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
