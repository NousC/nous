/**
 * Admin Access - Check admin status and provide Pro plan access
 */

// VIP email addresses that always get full Consultancies access
const VIP_EMAILS = [
  'bennetglinder@gmail.com',
  'bennetglinder@gmx.de',
  'bennet@kara-x.de',
  'collin@rev-box.com',
];

/**
 * Check if user email is in the VIP list
 * @param {string} email - User email address
 * @returns {boolean} True if email is in VIP list
 */
export function isVIPEmail(email) {
  if (!email) return false;
  return VIP_EMAILS.includes(email.toLowerCase());
}

/**
 * Check if user is admin (matches server.mjs pattern)
 * @param {Object} user - User object with id
 * @param {Object} supabase - Supabase client
 * @returns {Promise<boolean>} True if user is admin
 */
export async function checkAdmin(user, supabase) {
  if (!supabase) {
    console.error('[ADMIN_ACCESS] checkAdmin called without supabase client');
    return false;
  }
  if (!user || !user.id) {
    return false;
  }

  try {
    // Check users.is_admin field (matches server.mjs checkAdmin function)
    const { data: userData, error } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (error || !userData) {
      return false;
    }
    
    return userData.is_admin === true;
  } catch (error) {
    console.error('[ADMIN_ACCESS] Error checking admin:', error);
    return false;
  }
}

/**
 * Check if user has VIP access
 * @param {Object} user - User object with id
 * @param {Object} supabase - Supabase client
 * @returns {Promise<boolean>} True if user is VIP
 */
export async function checkVIPAccess(user, supabase) {
  if (!supabase) {
    console.error('[ADMIN_ACCESS] checkVIPAccess called without supabase client');
    return false;
  }
  if (!user || !user.id) {
    return false;
  }

  try {
    // Check users.is_vip field
    const { data: userData, error } = await supabase
      .from('users')
      .select('is_vip')
      .eq('id', user.id)
      .single();

    if (error || !userData) {
      return false;
    }
    
    return userData.is_vip === true;
  } catch (error) {
    console.error('[ADMIN_ACCESS] Error checking VIP access:', error);
    return false;
  }
}

/**
 * Check if user should get Pro plan access (admin in team or VIP)
 * @param {Object} user - User object with id
 * @param {string} teamId - Team ID
 * @param {Object} supabase - Supabase client
 * @returns {Promise<boolean>} True if user is admin in team or VIP
 */
export async function checkAdminScaleAccess(user, teamId, supabase) {
  if (!user || !user.id || !teamId) {
    return false;
  }

  try {
    // Check if user email is in hardcoded VIP list (for specific admin accounts)
    if (user.email && isVIPEmail(user.email)) {
      console.log('[ADMIN_ACCESS] VIP email detected:', user.email);
      return true;
    }

    // Check admin + VIP status and team membership in parallel (single query for user flags)
    const [userFlagsResult, teamMemberResult] = await Promise.all([
      supabase.from('users').select('is_admin, is_vip').eq('id', user.id).single(),
      supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', user.id).maybeSingle(),
    ]);

    // Check admin/VIP flags
    if (userFlagsResult.data) {
      if (userFlagsResult.data.is_admin === true) return true;
      if (userFlagsResult.data.is_vip === true) return true;
    }

    // Check team membership role
    const { data: teamMember, error } = teamMemberResult;
    if (error && error.code !== 'PGRST116') {
      console.error('[ADMIN_ACCESS] Error checking team membership:', error);
      return false;
    }

    // Only explicit admin/owner roles get Pro access (NOT founders - they get Standard plan)
    return teamMember && ['owner', 'admin'].includes(teamMember.role);
  } catch (error) {
    console.error('[ADMIN_ACCESS] Error checking admin scale access:', error);
    return false;
  }
}

/**
 * Get Consultancies plan limits (used for admin access)
 * @param {Object} supabase - Supabase client
 * @returns {Promise<Object>} Consultancies plan limits
 */
export async function getProPlanLimits(supabase) {
  try {
    const { data: consultanciesLimits, error } = await supabase
      .from('plan_limits')
      .select('*')
      .eq('plan_name', 'consultancies')
      .maybeSingle(); // Use maybeSingle() instead of single() to handle missing rows gracefully

    if (error) {
      console.error('[ADMIN_ACCESS] Error loading Consultancies plan limits:', error);
      // Return default Consultancies limits
      return {
        plan_name: 'consultancies',
        max_documents_per_month: 10000,
        max_workspaces: null,
        max_templates: null,
        max_graphics_per_template: null,
        max_research_reports_per_template: null,
        workflows_limit: -1,
        ai_writer_enabled: true,
        priority_support: true,
      };
    }

    // If no row found, return defaults
    if (!consultanciesLimits) {
      console.warn('[ADMIN_ACCESS] No Consultancies plan limits found in database, using defaults');
      return {
        plan_name: 'consultancies',
        max_documents_per_month: 10000,
        max_workspaces: null,
        max_templates: null,
        max_graphics_per_template: null,
        max_research_reports_per_month: null,
        workflows_limit: -1,
        ai_writer_enabled: true,
        priority_support: true,
      };
    }

    // Ensure admins always get unlimited workflows even if DB row exists but limit is low
    if (!consultanciesLimits.workflows_limit || consultanciesLimits.workflows_limit < 100) {
      consultanciesLimits.workflows_limit = -1;
    }

    return consultanciesLimits;
  } catch (error) {
    console.error('[ADMIN_ACCESS] Error getting Consultancies limits:', error);
    // Return default Consultancies limits
    return {
      plan_name: 'consultancies',
      max_documents_per_month: 10000,
      max_workspaces: null,
      max_templates: null,
      max_graphics_per_template: null,
      max_research_reports_per_template: null,
      ai_writer_enabled: true,
      priority_support: true,
    };
  }
}

/**
 * Get Scale plan limits (deprecated - kept for backward compatibility)
 * @param {Object} supabase - Supabase client
 * @returns {Promise<Object>} Pro plan limits (Scale is now Pro)
 */
export async function getScalePlanLimits(supabase) {
  // Return Pro limits for backward compatibility
  return getProPlanLimits(supabase);
}

