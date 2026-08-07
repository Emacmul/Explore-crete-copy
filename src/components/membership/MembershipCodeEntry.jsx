import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, AlertCircle, Loader2, Star } from 'lucide-react';

export default function MembershipCodeEntry({ appUser, onMembershipChanged }) {
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isMember = appUser?.is_member === true;

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const res = await base44.functions.invoke('verifyMembershipKey', {
        membershipKey: code.trim(),
      });

      const { valid } = res.data || {};

      if (!valid) {
        setError('Code not recognised or invalid. Please check it and try again.');
        setSaving(false);
        return;
      }

      await base44.entities.AppUser.update(appUser.id, {
        membership_code: code.trim().toUpperCase(),
        is_member: true,
      });

      setSuccess('Membership activated successfully!');
      setCode('');
      onMembershipChanged?.();
    } catch (err) {
      setError('Unable to activate membership at the moment.');
    }

    setSaving(false);
  };

  return (
    <div className="space-y-3">
      {isMember && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
          <Star className="w-4 h-4 text-green-600" />
          <span className="text-sm font-semibold text-green-700">
            Membership Active
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError('');
            setSuccess('');
          }}
          placeholder={
            isMember
              ? 'Enter replacement membership code'
              : 'Enter your membership code'
          }
          className="font-mono uppercase text-sm"
          disabled={saving}
        />

        <Button
          type="submit"
          disabled={saving || !code.trim()}
          size="sm"
          className="shrink-0"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            'Apply'
          )}
        </Button>
      </form>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      <p className="text-xs text-gray-400">
        Your membership code is supplied when you purchase a Magical Crete membership.
      </p>
    </div>
  );
}