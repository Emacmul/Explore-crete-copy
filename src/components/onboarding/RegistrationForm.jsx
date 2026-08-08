import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';
import DateOfBirthPicker from './DateOfBirthPicker';

export default function RegistrationForm({ user, onComplete }) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: '',
    newsletter_opted_in: true,
    password: '',
    confirm_password: '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*\-_+]).{8,}$/;

  const set = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const errs = {};
    if (!form.first_name.trim()) errs.first_name = 'Required';
    if (!form.last_name.trim()) errs.last_name = 'Required';
    if (!form.date_of_birth) errs.date_of_birth = 'Required';
    if (!form.gender) errs.gender = 'Please select one';
    if (!form.password) {
      errs.password = 'Required';
    } else if (!PASSWORD_REGEX.test(form.password)) {
      errs.password = 'Must be 8+ chars with uppercase, lowercase, number, and a special character (! @ # $ % ^ & * - _ +)';
    }
    if (!form.confirm_password) {
      errs.confirm_password = 'Required';
    } else if (form.password !== form.confirm_password) {
      errs.confirm_password = 'Passwords do not match';
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSaving(true);

    // Check if an AppUser record already exists for this user
    const existing = await base44.entities.AppUser.filter({ user_id: user.id });
    const payload = {
      user_id: user.id,
      email: user.email,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      date_of_birth: form.date_of_birth,
      gender: form.gender,
      newsletter_opted_in: form.newsletter_opted_in,
      password: form.password,
      registration_complete: true,
      is_member: false,
    };

    if (existing.length > 0) {
      await base44.entities.AppUser.update(existing[0].id, payload);
    } else {
      await base44.entities.AppUser.create(payload);
    }
    setSaving(false);
    onComplete();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 via-blue-800 to-blue-950 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white/15 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/20">
            <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">Welcome to Explore Crete</h1>
          <p className="text-blue-300 text-sm">Create your account to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 p-6 space-y-5">

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-blue-100 text-sm mb-1.5 block">First Name *</Label>
              <Input
                value={form.first_name}
                onChange={e => set('first_name', e.target.value)}
                placeholder="Anna"
                className="bg-white/10 border-white/20 text-white placeholder:text-blue-300/60"
              />
              {errors.first_name && <p className="text-red-400 text-xs mt-1">{errors.first_name}</p>}
            </div>
            <div>
              <Label className="text-blue-100 text-sm mb-1.5 block">Last Name *</Label>
              <Input
                value={form.last_name}
                onChange={e => set('last_name', e.target.value)}
                placeholder="Papadaki"
                className="bg-white/10 border-white/20 text-white placeholder:text-blue-300/60"
              />
              {errors.last_name && <p className="text-red-400 text-xs mt-1">{errors.last_name}</p>}
            </div>
          </div>

          {/* Email (read-only, from auth) */}
          <div>
            <Label className="text-blue-100 text-sm mb-1.5 block">Email Address</Label>
            <Input
              value={user?.email || ''}
              readOnly
              className="bg-white/5 border-white/10 text-blue-200 cursor-default"
            />
          </div>

          {/* Date of birth */}
          <div>
            <Label className="text-blue-100 text-sm mb-1.5 block">Date of Birth *</Label>
            <DateOfBirthPicker
              value={form.date_of_birth}
              onChange={v => set('date_of_birth', v)}
            />
            {errors.date_of_birth && <p className="text-red-400 text-xs mt-1">{errors.date_of_birth}</p>}
          </div>

          {/* Gender */}
          <div>
            <Label className="text-blue-100 text-sm mb-2 block">Gender *</Label>
            <div className="flex gap-3">
              {[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('gender', opt.value)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    form.gender === opt.value
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'bg-white/10 border-white/20 text-blue-200 hover:bg-white/15'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {errors.gender && <p className="text-red-400 text-xs mt-1">{errors.gender}</p>}
          </div>

          {/* Password */}
          <div>
            <Label className="text-blue-100 text-sm mb-1.5 block">Password *</Label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="••••••••"
                className="bg-white/10 border-white/20 text-white placeholder:text-blue-300/60 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
          </div>

          {/* Confirm Password */}
          <div>
            <Label className="text-blue-100 text-sm mb-1.5 block">Confirm Password *</Label>
            <div className="relative">
              <Input
                type={showConfirm ? 'text' : 'password'}
                value={form.confirm_password}
                onChange={e => set('confirm_password', e.target.value)}
                placeholder="••••••••"
                className="bg-white/10 border-white/20 text-white placeholder:text-blue-300/60 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.confirm_password && <p className="text-red-400 text-xs mt-1">{errors.confirm_password}</p>}
          </div>

          {/* Divider */}
          <div className="border-t border-white/10 pt-1" />

          {/* Newsletter opt-in */}
          <div className="flex gap-3 bg-white/5 border border-white/10 rounded-xl p-3">
            <div className="shrink-0 mt-0.5">
              <button
                type="button"
                onClick={() => set('newsletter_opted_in', !form.newsletter_opted_in)}
                className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${
                  form.newsletter_opted_in
                    ? 'bg-amber-500 border-amber-500'
                    : 'bg-white/10 border-white/30'
                }`}
              >
                {form.newsletter_opted_in && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
              </button>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <Mail className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-white text-xs font-semibold">Newsletter</span>
              </div>
              <p className="text-blue-200 text-xs leading-relaxed">
                Receive emails about new walks, routes, and app updates. You can unsubscribe at any time.
              </p>
            </div>
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold h-11 text-base gap-2"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {saving ? 'Saving...' : 'Complete Registration'}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}