/**
 * Centralized Theme Colors Configuration
 * Separate themes for User and Vendor modules
 * Update colors here to change theme across entire app
 * 
 * Usage:
 * - User module: import { userTheme } from '../../../../theme'
 * - Vendor module: import { vendorTheme } from '../../../../theme'
 * - Worker module: import { workerTheme } from '../../../../theme'
 */

// KSG logo brand colours. Key names kept for existing callers: teal = navy, yellow = saffron, orange = green.
const brand = {
  teal: '#0B2A6F',
  yellow: '#FF7A00',
  orange: '#16A34A',
  gradient: 'linear-gradient(135deg, #0B2A6F 0%, #FF7A00 50%, #16A34A 100%)',
  conic: 'conic-gradient(from 0deg, #0B2A6F, #FF7A00, #16A34A, #0B2A6F)'
};

// User Theme Colors
const userTheme = {
  backgroundGradient: 'linear-gradient(180deg, #FFF7ED 0%, #F5FAFF 15%, #FFFFFF 30%)',
  gradient: brand.gradient,
  headerGradient: 'linear-gradient(135deg, #0B2A6F 0%, #123A8F 50%, #071A47 100%)',
  headerBg: '#EBF8FF',
  button: brand.teal,
  icon: brand.teal,
  cardShadow: '0 8px 16px -2px rgba(11, 42, 111, 0.15), 0 4px 8px -1px rgba(11, 42, 111, 0.1)',
  cardBorder: '1px solid rgba(11, 42, 111, 0.15)',
  brand: brand
};

// Vendor Theme Colors
const vendorTheme = {
  backgroundGradient: 'linear-gradient(to bottom, rgba(11, 42, 111, 0.03) 0%, rgba(255, 122, 0, 0.02) 10%, #ffffff 20%)',
  gradient: brand.gradient,
  headerGradient: brand.teal,
  button: brand.teal,
  icon: brand.teal,
  brand: brand
};

// Worker Theme Colors
const workerTheme = {
  backgroundGradient: 'linear-gradient(to bottom, rgba(11, 42, 111, 0.03) 0%, rgba(255, 122, 0, 0.02) 10%, #ffffff 20%)',
  gradient: brand.gradient,
  headerGradient: brand.teal,
  button: brand.teal,
  icon: brand.teal,
  brand: brand
};

// Default theme (for backward compatibility)
const themeColors = userTheme;

// Export all themes
export { userTheme, vendorTheme, workerTheme, brand };
export default themeColors;



